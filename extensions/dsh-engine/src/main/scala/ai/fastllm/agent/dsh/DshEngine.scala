package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.{Admit, AgentAttachProtocol, AgentLoop}
import ai.fastllm.agent.dsh.proc.DshProcess
import ai.fastllm.agent.engine.{
  Engine, EngineCallResult, EngineCapabilities, EngineConfig, EngineHost, EngineId, EngineRuntime,
  EngineSession, EngineSessionContext
}
import io.circe.Json
import io.circe.syntax.*

import java.util.concurrent.atomic.AtomicBoolean
import scala.concurrent.{ExecutionContext, Future}

final class DshEngine(bootOf: EngineHost => Option[DshBoot])(using ExecutionContext) extends Engine:
  def id: EngineId = EngineId("dsh")
  def start(host: EngineHost): Future[EngineRuntime] =
    bootOf(host) match
      case None => Future.failed(IllegalStateException("dsh process off"))
      case Some(boot) =>
        boot.ready.transformWith:
          case scala.util.Success(_) => Future.successful(DshRuntime(boot))
          case scala.util.Failure(e) =>
            boot.close()
            Future.failed(e)

object DshEngine:
  /** YAML-enabled start: attach config/env port, else spawn command, else official 3080. */
  def fromHost(host: EngineHost, config: EngineConfig = EngineConfig())(using ExecutionContext): Option[DshBoot] =
    DshBoot.of(
      cwdOf = sid => host.workspace.pathOf(sid),
      onTitle = (sid, t) => host.sessions.setTitle(sid, t),
      onTurnBegin = (sid, run) => host.runs.turnBegin(sid, run),
      onTurnEnd = (sid, run, ids) => host.runs.turnEnd(sid, run, ids),
      onChildOpen = sid => host.runs.childOpen(sid),
      onError = (sid, msg) => host.events.error(sid, msg),
      onGoal = (sid, op, phase, title, text) => host.events.goal(sid, op, phase, title, text),
      process = processOf(config)
    )

  def processOf(config: EngineConfig): Option[DshProcess] =
    val port = DshRoots.port(config)
    val cfgCmd = config("command").flatMap(_.asString).map(_.trim).filter(_.nonEmpty)
    val envCmd = sys.env.get("FAST_DSH_COMMAND").map(_.trim).filter(_.nonEmpty)
    val local = DshRoots.command()
    val cmd = cfgCmd.orElse(envCmd).orElse(local).filterNot(DshRoots.rejectsNpx)
    if DshProbe.ready("127.0.0.1", port) then Some(DshProcess.attach(port))
    else if cmd.isDefined && DshRoots.installed() then Some(DshProcess.spawn(cmd.get))
    else None

final class DshRuntime(boot: DshBoot)(using ExecutionContext) extends EngineRuntime:
  val id: EngineId = EngineId("dsh")
  private val closed = AtomicBoolean(false)

  def open(session: EngineSessionContext): Future[EngineSession] =
    if closed.get then Future.failed(IllegalStateException("dsh closed"))
    else Future.successful(DshSession(boot.loop, session, canSteer = true, canQueue = true))

  def call(method: String, payload: Json): Future[EngineCallResult] =
    if closed.get then Future.successful(EngineCallResult.Failed(Json.obj("code" -> "closed".asJson)))
    else
      val sid = payload.hcursor.get[String]("sessionId").toOption.map(_.trim).filter(_.nonEmpty)
      boot.face.dispatch(method, payload, sid).map(DshRuntime.resultOf)

  def close(): Future[Unit] =
    if closed.compareAndSet(false, true) then boot.close()
    Future.unit

object DshRuntime:
  def resultOf(json: Json): EngineCallResult =
    json.hcursor.get[Boolean]("ok") match
      case Right(false) =>
        EngineCallResult.Failed(json.hcursor.downField("error").focus.getOrElse(json))
      case Right(true) =>
        EngineCallResult.Value(json.hcursor.downField("value").focus.getOrElse(Json.obj()))
      case _ =>
        EngineCallResult.Failed(Json.obj("code" -> "internal".asJson))

final class DshSession(
    loop: AgentLoop,
    context: EngineSessionContext,
    canSteer: Boolean = true,
    canQueue: Boolean = true
) extends EngineSession:
  private val closed = AtomicBoolean(false)
  private val sid = context.sessionId
  val caps: EngineCapabilities = EngineCapabilities.of(loop.caps, canSteer, canQueue)

  def submit(cmd: AgentAttachProtocol.Command.SubmitUserMessage) = loop.submit(cmd.copy(sessionId = sid))
  def cancel(cmd: AgentAttachProtocol.Command.CancelRun) = loop.cancel(cmd.copy(sessionId = sid))
  def decide(cmd: AgentAttachProtocol.Command.DecideApproval) = loop.decide(cmd.copy(sessionId = sid))
  def answer(cmd: AgentAttachProtocol.Command.AnswerQuestionBatch) = loop.answer(cmd.copy(sessionId = sid))
  def restore(beforeTurnId: Option[String], limit: Int) = loop.restore(sid, beforeTurnId, limit)
  def events(afterSeq: Long) = loop.events(sid, afterSeq)
  def busy: Boolean = loop.busy(sid)
  def liveRun: Option[String] = loop.liveRun(sid)
  def childOpen: Boolean = loop.childOpen(sid)

  def call(method: String, payload: Json): Future[EngineCallResult] =
    if closed.get then Future.successful(EngineCallResult.Failed(Json.obj("code" -> "closed".asJson)))
    else
      method match
        case "steer" if caps.steer =>
          val text = payload.hcursor.get[String]("text").getOrElse("")
          val images = DshSession.imagesOf(payload)
          loop.steer(AgentAttachProtocol.Command.DshSteer(sid, text, images))
            .map(EngineCallResult.Admitted.apply)(using ExecutionContext.parasitic)
        case "queue" if caps.queue =>
          val itemId = payload.hcursor.get[String]("itemId").getOrElse("")
          val action = payload.hcursor.get[String]("action").getOrElse("")
          val text = payload.hcursor.get[String]("text").toOption
          loop.queue(AgentAttachProtocol.Command.DshQueue(sid, itemId, action, text))
            .map(EngineCallResult.Admitted.apply)(using ExecutionContext.parasitic)
        case "steer" =>
          Future.successful(EngineCallResult.Admitted(Admit.Rejected("dsh_steer")))
        case "queue" =>
          Future.successful(EngineCallResult.Admitted(Admit.Rejected("dsh_queue")))
        case other =>
          Future.successful(EngineCallResult.Failed(Json.obj("code" -> "unsupported".asJson, "method" -> other.asJson)))

  def close(): Future[Unit] =
    closed.compareAndSet(false, true)
    Future.unit

object DshSession:
  def imagesOf(payload: Json): List[AgentAttachProtocol.SubmitImage] =
    payload.hcursor.downField("images").as[List[Json]].toOption.getOrElse(Nil).flatMap: img =>
      val c = img.hcursor
      for
        media <- c.get[String]("mediaType").toOption.orElse(c.get[String]("media_type").toOption)
        data <- c.get[String]("data").toOption
      yield AgentAttachProtocol.SubmitImage(media, data)
