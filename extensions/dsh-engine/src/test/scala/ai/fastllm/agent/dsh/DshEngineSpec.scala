package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.{
  Admit, AgentAttachProtocol, AgentLoop, Caps, ChannelMessageWindow, EventRow, RouteResult
}
import ai.fastllm.agent.engine.{EngineCallResult, EngineHosts, EngineId, EngineSessionContext}
import ai.fastllm.agent.remote.Client
import io.circe.Json
import io.circe.syntax.*
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.{Await, Future, Promise}
import scala.concurrent.duration.*

class DshEngineSpec extends AnyFunSuite with Matchers:

  private def await[A](f: Future[A]): A = Await.result(f, 4.seconds)

  private def bootOf(loop: AgentLoop, face: DshFace, ready: Future[Unit] = Future.unit, onClose: () => Unit = () => ()): DshBoot =
    DshBoot(loop, face, onClose, ready)

  test("busy steer is Steered of the same live run"):
    val loop = EngineRecordingLoop()
    loop.live = Some("sess-1:c1")
    loop.admit = Admit.Steered("sess-1:c1")
    val remote = EngineFaceClient()
    val face = DshFace(remote, _ => "/tmp", DshLoop(remote, _ => "/tmp"))
    val session = await(DshRuntime(bootOf(loop, face)).open(EngineSessionContext("sess-1")))
    session.liveRun shouldBe Some("sess-1:c1")
    await(session.call("steer", Json.obj("text" -> "nudge".asJson, "images" -> Json.arr()))) shouldBe
      EngineCallResult.Admitted(Admit.Steered("sess-1:c1"))
    session.liveRun shouldBe Some("sess-1:c1")

  test("session table binds the fixed sessionId onto boot.loop"):
    val loop = EngineRecordingLoop()
    val remote = EngineFaceClient()
    val face = DshFace(remote, _ => "/tmp", DshLoop(remote, _ => "/tmp"))
    val session = await(DshRuntime(bootOf(loop, face)).open(EngineSessionContext("s1")))
    await(session.submit(AgentAttachProtocol.Command.SubmitUserMessage("other", "c", "hi")))
    loop.submits.head.sessionId shouldBe "s1"
    await(session.cancel(AgentAttachProtocol.Command.CancelRun("other", "r", "x")))
    loop.cancels.head.sessionId shouldBe "s1"
    await(session.decide(AgentAttachProtocol.Command.DecideApproval("other", "r", "a", true)))
    loop.decides.head.sessionId shouldBe "s1"
    await(session.answer(AgentAttachProtocol.Command.AnswerQuestionBatch("other", "rpc")))
    loop.answers.head.sessionId shouldBe "s1"
    await(session.restore(Some("t"), 8))
    loop.restores shouldBe Vector(("s1", Some("t"), 8))
    await(session.events(3L))
    loop.eventAfter shouldBe Vector(("s1", 3L))
    loop.busyFlag = true
    loop.live = Some("r")
    loop.child = true
    session.busy shouldBe true
    session.liveRun shouldBe Some("r")
    session.childOpen shouldBe true

  test("steer payload is text+images without sessionId; queue matches DshQueue fields"):
    val loop = EngineRecordingLoop()
    val remote = EngineFaceClient()
    val face = DshFace(remote, _ => "/tmp", DshLoop(remote, _ => "/tmp"))
    val session = await(DshRuntime(bootOf(loop, face)).open(EngineSessionContext("s1")))
    val steer = Json.obj("text" -> "nudge".asJson, "images" -> Json.arr())
    steer.hcursor.keys.get.toSet shouldBe Set("text", "images")
    await(session.call("steer", steer))
    loop.steers.head.sessionId shouldBe "s1"
    loop.steers.head.text shouldBe "nudge"
    val queue = Json.obj("itemId" -> "m1".asJson, "action" -> "remove".asJson, "text" -> "x".asJson)
    await(session.call("queue", queue))
    loop.queues.head shouldBe AgentAttachProtocol.Command.DshQueue("s1", "m1", "remove", Some("x"))

  test("caps gate: steer/queue without bits do not reach face or loop"):
    val loop = EngineRecordingLoop()
    val remote = EngineFaceClient()
    val face = DshFace(remote, _ => "/tmp", DshLoop(remote, _ => "/tmp"))
    val session = DshSession(loop, EngineSessionContext("s1"), canSteer = false, canQueue = false)
    await(session.call("steer", Json.obj("text" -> "x".asJson))) shouldBe
      EngineCallResult.Admitted(Admit.Rejected("dsh_steer"))
    await(session.call("queue", Json.obj("itemId" -> "i".asJson, "action" -> "remove".asJson))) shouldBe
      EngineCallResult.Admitted(Admit.Rejected("dsh_queue"))
    loop.steers shouldBe empty
    loop.queues shouldBe empty
    remote.methods shouldBe empty

  test("Runtime.call settings.describe does not require open"):
    val remote = EngineFaceClient()
    val dshLoop = DshLoop(remote, _ => "/tmp")
    val face = DshFace(remote, _ => "/tmp", dshLoop)
    val rt = DshRuntime(bootOf(dshLoop, face))
    await(rt.call("settings.describe", Json.obj())) shouldBe EngineCallResult.Value(Json.obj())
    remote.methods shouldBe Vector("settings.describe")

  test("Runtime.call session.models works before open and keeps the method name"):
    val remote = EngineFaceClient()
    val dshLoop = DshLoop(remote, _ => "/tmp")
    val face = DshFace(remote, _ => "/tmp", dshLoop)
    val rt = DshRuntime(bootOf(dshLoop, face))
    await(rt.call("session.models", Json.obj("sessionId" -> "s1".asJson)))
    remote.methods should contain("session.models")
    remote.methods.head shouldBe "session.create"

  test("session.call only accepts steer and queue"):
    val loop = EngineRecordingLoop()
    val remote = EngineFaceClient()
    val session = DshSession(loop, EngineSessionContext("s1"))
    await(session.call("settings.describe", Json.obj())) should matchPattern { case EngineCallResult.Failed(_) => }
    await(session.call("session.models", Json.obj())) should matchPattern { case EngineCallResult.Failed(_) => }
    loop.steers shouldBe empty

  test("start fails before ready and does not register"):
    val ready = Promise[Unit]()
    var closed = false
    val remote = EngineFaceClient()
    val dshLoop = DshLoop(remote, _ => "/tmp")
    val boot = bootOf(dshLoop, DshFace(remote, _ => "/tmp", dshLoop), ready.future, () => closed = true)
    val started = DshEngine(_ => Some(boot)).start(EngineHosts.wave1())
    started.isCompleted shouldBe false
    ready.failure(IllegalStateException("not ready"))
    intercept[IllegalStateException](await(started)).getMessage shouldBe "not ready"
    closed shouldBe true

  test("start ready then open; close rejects later call and open"):
    val remote = EngineFaceClient()
    val dshLoop = DshLoop(remote, _ => "/tmp")
    var closed = false
    val boot = bootOf(dshLoop, DshFace(remote, _ => "/tmp", dshLoop), Future.unit, () => closed = true)
    val rt = await(DshEngine(_ => Some(boot)).start(EngineHosts.wave1()))
    await(rt.open(EngineSessionContext("s1")))
    await(rt.close())
    closed shouldBe true
    intercept[IllegalStateException](await(rt.open(EngineSessionContext("s2"))))
    await(rt.call("settings.describe", Json.obj())) should matchPattern { case EngineCallResult.Failed(_) => }

  test("two sessions share one runtime and closing one does not close the other"):
    val loop = EngineRecordingLoop()
    val remote = EngineFaceClient()
    val rt = DshRuntime(bootOf(loop, DshFace(remote, _ => "/tmp", DshLoop(remote, _ => "/tmp"))))
    val a = await(rt.open(EngineSessionContext("a")))
    val b = await(rt.open(EngineSessionContext("b")))
    await(a.close())
    await(b.submit(AgentAttachProtocol.Command.SubmitUserMessage("x", "c", "hi")))
    loop.submits.last.sessionId shouldBe "b"
    await(rt.call("settings.describe", Json.obj())) should matchPattern { case EngineCallResult.Value(_) => }

private class EngineRecordingLoop extends AgentLoop:
  var submits: Vector[AgentAttachProtocol.Command.SubmitUserMessage] = Vector.empty
  var cancels: Vector[AgentAttachProtocol.Command.CancelRun] = Vector.empty
  var decides: Vector[AgentAttachProtocol.Command.DecideApproval] = Vector.empty
  var answers: Vector[AgentAttachProtocol.Command.AnswerQuestionBatch] = Vector.empty
  var steers: Vector[AgentAttachProtocol.Command.DshSteer] = Vector.empty
  var queues: Vector[AgentAttachProtocol.Command.DshQueue] = Vector.empty
  var restores: Vector[(String, Option[String], Int)] = Vector.empty
  var eventAfter: Vector[(String, Long)] = Vector.empty
  var admit: Admit = Admit.Accepted("run-1")
  var route: RouteResult = RouteResult("accepted", "run-1", "ok")
  var busyFlag: Boolean = false
  var live: Option[String] = None
  var child: Boolean = false
  val caps: Caps = Caps(cancel = true, approval = true, question = false, restore = true)
  def submit(cmd: AgentAttachProtocol.Command.SubmitUserMessage) = { submits = submits :+ cmd; Future.successful(admit) }
  def cancel(cmd: AgentAttachProtocol.Command.CancelRun) = { cancels = cancels :+ cmd; Future.successful(admit) }
  override def decide(cmd: AgentAttachProtocol.Command.DecideApproval) = { decides = decides :+ cmd; Future.successful(route) }
  override def answer(cmd: AgentAttachProtocol.Command.AnswerQuestionBatch) = { answers = answers :+ cmd; Future.successful(route) }
  override def steer(cmd: AgentAttachProtocol.Command.DshSteer) = { steers = steers :+ cmd; Future.successful(admit) }
  override def queue(cmd: AgentAttachProtocol.Command.DshQueue) = { queues = queues :+ cmd; Future.successful(admit) }
  def events(sessionId: String, afterSeq: Long) = { eventAfter = eventAfter :+ (sessionId -> afterSeq); Future.successful(Nil) }
  def restore(sessionId: String, beforeTurnId: Option[String], limit: Int) =
    restores = restores :+ (sessionId, beforeTurnId, limit)
    Future.successful(ChannelMessageWindow(Nil, false, 0))
  override def busy(sessionId: String) = busyFlag
  override def liveRun(sessionId: String) = live
  override def childOpen(sessionId: String) = child

private class EngineFaceClient extends Client:
  var methods: Vector[String] = Vector.empty
  def call(method: String, payload: Json): Future[Json] =
    methods = methods :+ method
    method match
      case "session.create" =>
        Future.successful(Json.obj("ok" -> Json.True, "value" -> Json.obj("sessionId" -> "s1".asJson)))
      case "session.models" =>
        Future.successful(Json.obj("ok" -> Json.True, "value" -> Json.obj("routable" -> Json.True)))
      case "settings.describe" =>
        Future.successful(Json.obj("ok" -> Json.True, "value" -> Json.obj()))
      case _ =>
        Future.successful(Json.obj("ok" -> Json.True, "value" -> Json.obj()))
  def reply(rpcId: String, value: Json): Future[Unit] = Future.unit
  def listen(channel: String)(emit: Json => Unit): Unit = ()
  def ready: Future[Unit] = Future.unit
  def close(): Unit = ()
