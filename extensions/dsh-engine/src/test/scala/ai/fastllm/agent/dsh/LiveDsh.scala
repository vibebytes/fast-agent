package ai.fastllm.agent.dsh

import ai.fastllm.agent.dsh.http.DshHttp
import ai.fastllm.agent.dsh.proc.DshProcess
import io.circe.Json

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.*
import scala.concurrent.{Await, Future}
import scala.util.control.NonFatal

/** Live DSH web on loopback. Attach if reachable; spawn only when `FAST_DSH_COMMAND` is set. */
final class LiveDsh(val port: Int, spawned: Option[DshProcess]):
  def close(): Unit = spawned.foreach(_.close())

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
    candidates.distinct.find(reachable).map(p => LiveDsh(p, None))

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
    if !reachable(port) then
      proc.close()
      throw RuntimeException(s"spawned DSH on $port but host.describe failed")
    LiveDsh(port, Some(proc))

  def reachable(port: Int): Boolean =
    val remote = DshHttp(Future.successful(port))
    try
      val json = Await.result(remote.call("host.describe", Json.obj()), 4.seconds)
      json.hcursor.get[Boolean]("ok").toOption.contains(true)
    catch
      case NonFatal(_) => false
    finally remote.close()
