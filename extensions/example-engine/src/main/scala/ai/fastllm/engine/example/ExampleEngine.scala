package ai.fastllm.engine.example

import ai.fastllm.agent.channel.{
  Admit, AgentAttachProtocol, ChannelMessageWindow, EventRow, RouteResult
}
import ai.fastllm.agent.engine.{
  Engine, EngineCallResult, EngineCapabilities, EngineConfig, EngineHost, EngineId, EngineProvider,
  EngineRuntime, EngineSession, EngineSessionContext
}
import io.circe.Json

import scala.concurrent.Future

final class ExampleProvider extends EngineProvider:
  def id: EngineId = EngineId("example")
  def apiVersion: String = EngineId.ApiVersion
  def create(config: EngineConfig): Engine = ExampleEngine(config)

final class ExampleEngine(val config: EngineConfig) extends Engine:
  def id: EngineId = EngineId("example")
  def start(host: EngineHost): Future[EngineRuntime] = Future.successful(ExampleRuntime())

final class ExampleRuntime extends EngineRuntime:
  val id: EngineId = EngineId("example")
  def open(session: EngineSessionContext): Future[EngineSession] =
    Future.successful(ExampleSession(session.sessionId))
  def call(method: String, payload: Json): Future[EngineCallResult] =
    Future.successful(EngineCallResult.Value(Json.obj()))
  def close(): Future[Unit] = Future.unit

final class ExampleSession(sid: String) extends EngineSession:
  def caps: EngineCapabilities = EngineCapabilities(true, false, false, false)
  def submit(cmd: AgentAttachProtocol.Command.SubmitUserMessage) =
    Future.successful(Admit.Accepted(s"$sid:1"))
  def cancel(cmd: AgentAttachProtocol.Command.CancelRun) = Future.successful(Admit.Rejected("no"))
  def decide(cmd: AgentAttachProtocol.Command.DecideApproval) =
    Future.successful(RouteResult("rejected", "", "no"))
  def answer(cmd: AgentAttachProtocol.Command.AnswerQuestionBatch) =
    Future.successful(RouteResult("rejected", "", "no"))
  def restore(beforeTurnId: Option[String], limit: Int) =
    Future.successful(ChannelMessageWindow(Nil, false, 0))
  def events(afterSeq: Long) = Future.successful(List.empty[EventRow])
  def busy = false
  def liveRun = None
  def childOpen = false
  def call(method: String, payload: Json) = Future.successful(EngineCallResult.Failed(Json.obj()))
  def close() = Future.unit
