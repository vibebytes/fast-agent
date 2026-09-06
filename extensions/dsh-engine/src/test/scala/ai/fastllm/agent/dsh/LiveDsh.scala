package ai.fastllm.agent.dsh

import ai.fastllm.agent.dsh.http.DshHttp
import ai.fastllm.agent.dsh.proc.{DshProcess, launchToken}
import io.circe.Json

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.*
import scala.concurrent.{Await, Future}
import scala.util.control.NonFatal

/** Live DSH web on loopback. Attach if reachable; spawn only when `FAST_DSH_COMMAND` is set. */
final class LiveDsh(val port: Int, spawned: Option[DshProcess], val token: Option[String] = None):
  def close(): Unit = spawned.foreach(_.close())

  def http(muxReadySec: Long = 5): DshHttp =
    DshHttp(Future.successful(port), muxReadySec, Future.successful(token))

object LiveDsh:
  def open: LiveDsh =
    attachExisting.getOrElse:
      val cmd = sys.env.get("FAST_DSH_COMMAND").map(_.trim).filter(_.nonEmpty)
      val explicitPort =
        sys.env.get("FAST_DSH_PORT").exists(_.trim.nonEmpty) ||
          sys.props.get("fast.dsh.port").exists(_.trim.nonEmpty)
      cmd match
        case Some(c) => spawn(c)
        case None if explicitPort =>
          throw RuntimeException("FAST_DSH_PORT / fast.dsh.port set but DSH unreachable")
        case None =>
          org.scalatest.Assertions.cancel(
            "no live DSH on 3080; set FAST_DSH_PORT or FAST_DSH_COMMAND to require the hop"
          )

  def attachExisting: Option[LiveDsh] =
    val tok = launchToken
    candidates.distinct.find(p => reachable(p, tok)).map(p => LiveDsh(p, None, tok))

  private def candidates: List[Int] =
    (sys.props.get("fast.dsh.port").toList ++
      sys.env.get("FAST_DSH_PORT").toList ++
      List("3080"))
      .map(_.trim).filter(_.nonEmpty).flatMap(_.toIntOption)

  private def spawn(command: String): LiveDsh =
    val proc = DshProcess.spawn(command)
    val port =
      try Await.result(proc.port, 20.seconds)
      catch
        case NonFatal(e) =>
          proc.close()
          throw RuntimeException(
            s"live DSH required: start `npx @deepseek-ai/dsh web` or set FAST_DSH_PORT (${e.getMessage})",
            e
          )
    val tok =
      try Await.result(proc.token, 2.seconds)
      catch case NonFatal(_) => None
    if !reachable(port, tok) then
      proc.close()
      throw RuntimeException(s"spawned DSH on $port but settings.describe failed")
    LiveDsh(port, Some(proc), tok)

  def reachable(port: Int, token: Option[String] = launchToken): Boolean =
    if token.forall(_.isEmpty) then false
    else
      val remote = DshHttp(Future.successful(port), tokenOf = Future.successful(token))
      try
        val json = Await.result(remote.call("settings.describe", Json.obj()), 8.seconds)
        json.hcursor.get[Boolean]("ok").toOption.contains(true)
      catch
        case NonFatal(_) => false
      finally remote.close()
