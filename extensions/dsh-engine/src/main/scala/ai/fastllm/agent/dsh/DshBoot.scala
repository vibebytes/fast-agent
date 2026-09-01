package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.AgentLoop
import ai.fastllm.agent.dsh.http.DshHttp
import ai.fastllm.agent.dsh.proc.DshProcess
import org.slf4j.LoggerFactory

import scala.concurrent.ExecutionContext
import scala.concurrent.Future
import scala.util.{Failure, Success}

/** Process-wide DSH loop + face. Always constructed; attaches official 3080 when env is unset. */
final class DshBoot(val loop: AgentLoop, val face: DshFace, closeFn: () => Unit, val ready: Future[Unit] = Future.unit):
  def close(): Unit = closeFn()

object DshBoot:
  private lazy val log = LoggerFactory.getLogger(classOf[DshBoot])

  def of(
      cwdOf: String => String,
      onTitle: (String, String) => Unit = (_, _) => (),
      onTurnBegin: (String, String) => Future[Unit] = (_, _) => Future.unit,
      onTurnEnd: (String, String, Vector[String]) => Future[Unit] = (_, _, _) => Future.unit,
      onChildOpen: String => Unit = _ => (),
      onError: (String, String) => Unit = (_, _) => (),
      onGoal: (String, String, String, String, String) => Unit = (_, _, _, _, _) => (),
      process: Option[DshProcess] = DshProcess.of
  )(using ExecutionContext): Option[DshBoot] =
    process.map: proc =>
      val remote = DshHttp(proc.port)
      val loop = DshLoop(remote, cwdOf, onTitle, onTurnBegin, onTurnEnd, onChildOpen, onError, onGoal)
      val face = DshFace(remote, cwdOf, loop)
      remote.ready.onComplete:
        case Success(_) => log.info("dsh host ready")
        case Failure(e) => log.warn(s"dsh host not ready: ${e.getMessage}")
      DshBoot(
        loop,
        face,
        () =>
          remote.close()
          proc.close(),
        remote.ready
      )
