package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.{Admit, AgentAttachProtocol, AgentLoop, Caps, ChannelMessageWindow, EventRow, RouteResult, dshQueuedOnto, isEngineBusy}
import ai.fastllm.agent.engine.{EngineId, EngineIds, EngineSwitch}
import ai.fastllm.agent.remote.Client
import io.circe.Json
import io.circe.parser.parse
import io.circe.syntax.*
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import scala.concurrent.ExecutionContext
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.{Await, Future, Promise}
import scala.concurrent.duration.*
import scala.io.Source

class DshLoopSpec extends AnyFunSuite with Matchers:

  private val Sid = "sess-1"
  private val Cwd = "/tmp/proj"

  test("bind creates without submit; second bind is a no-op"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.bind(Sid, Cwd)) shouldBe Right(())
    methods(remote) shouldBe List("session.create")
    await(loop.bind(Sid, Cwd)) shouldBe Right(())
    methods(remote) shouldBe List("session.create")
    await(loop.submit(submit("c1", "hi"))) shouldBe Admit.Accepted(s"$Sid:c1")
    methods(remote).count(_ == "session.create") shouldBe 1
    methods(remote) should contain("session.prompt")

  test("submit still rejects structured skillSlash"):
    val loop = DshLoop(FakeClient(), _ => Cwd)
    val cmd = AgentAttachProtocol.Command.SubmitUserMessage(
      Sid,
      "c1",
      "/demo",
      skillSlash = Some(AgentAttachProtocol.SkillSlashPayload("demo", "", "/demo"))
    )
    await(loop.submit(cmd)) shouldBe Admit.Rejected("dsh_slash")

  test("submit → create + queue prompt; mux deltas land in events in order"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi"))) shouldBe Admit.Accepted(s"$Sid:c1")
    methods(remote) shouldBe List("session.create", "session.prompt")
    modeOf(remote.calls.last._2) shouldBe "queue"
    createCwd(remote.calls.head._2) shouldBe Cwd
    createWorkspaceId(remote.calls.head._2) shouldBe ""
    createSessionId(remote.calls.head._2) shouldBe Sid
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, chunk(2, "Hel"))
    remote.emit(Sid, chunk(3, "lo"))
    payloadTypes(await(loop.events(Sid, 0))) shouldBe List(
      "TurnStarted",
      "AssistantDelta",
      "AssistantDelta"
    )
    payloadTypes(await(loop.events(Sid, 0))) should not contain "RunCreated"
    val rows = await(loop.events(Sid, 0))
    rows.filter(_.seq > 0).map(_.seq) shouldBe List(1L, 2L, 3L)
    await(loop.events(Sid, 1)).filter(_.seq > 0).map(_.seq) shouldBe List(2L, 3L)

  test("same DSH seq is not translated twice"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, chunk(2, "Hel"))
    remote.emit(Sid, chunk(2, "Hel"))
    payloadTypes(await(loop.events(Sid, 0))) shouldBe List("AssistantDelta")
    parse(await(loop.events(Sid, 0)).last.envelopeJson).toOption.get
      .hcursor.downField("payload").get[String]("text").toOption.get shouldBe "Hel"

  test("busy second submit queues; never Fast queued; no second create"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "one"))) shouldBe Admit.Accepted(s"$Sid:c1")
    val second = await(loop.submit(submit("c2", "two")))
    second shouldBe Admit.Steered(s"$Sid:c1")
    second should not be a[Admit.Queued]
    methods(remote).count(_ == "workspace.create") shouldBe 0
    methods(remote).count(_ == "session.create") shouldBe 1
    remote.calls.filter(_._1 == "session.prompt").map(c => modeOf(c._2)) shouldBe List("queue", "queue")

  test("turn/end clears the latch; next submit queues a new runId"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "one")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, ev("turn/end", 2, """{"turn":1,"reason":{"kind":"completed"}}"""))
    await(loop.submit(submit("c3", "next"))) shouldBe Admit.Accepted(s"$Sid:c3")
    remote.calls.filter(_._1 == "session.prompt").map(c => modeOf(c._2)) shouldBe List("queue", "queue")

  test("turn/end completed also emits RunCompleted so the river can settle"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, ev("turn/end", 2, """{"turn":1,"reason":{"kind":"completed"}}"""))
    payloadTypes(await(loop.events(Sid, 0))) shouldBe List(
      "TurnStarted",
      "RunCompleted"
    )

  test("events hole sentinel: afterSeq behind bufferFloor is not an empty idle"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd, bufferCap = 3)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    (2 to 6).foreach(i => remote.emit(Sid, chunk(i, s"t$i")))
    await(loop.events(Sid, 0)).filter(_.seq > 0).map(_.seq) shouldBe List(4L, 5L, 6L)
    val hole = await(loop.events(Sid, 1))
    hole should not be empty
    val gap = hole.find(r => payloadType(r) == "gap").get
    parse(gap.envelopeJson).toOption.get.hcursor.downField("payload").get[Long]("floor").toOption.get shouldBe 4L
    parse(gap.envelopeJson).toOption.get.hcursor.downField("payload").get[Long]("high").toOption.get shouldBe 6L

  test("mux for an unbound session is dropped"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    remote.emit("other", chunk(1, "nope"))
    await(loop.events("other", 0)) shouldBe Nil
    await(loop.events(Sid, 0)) shouldBe Nil

  test("idle compaction still translates; idle assistant chunk does not"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/end", 1, """{"turn":1,"reason":{"kind":"completed"}}"""))
    val from = await(loop.events(Sid, 0)).last.seq
    remote.emit(Sid, chunk(2, "late"))
    remote.emit(Sid, ev("compaction/start", 3, """{"compactionId":"cmp-1","turn":null}"""))
    val rows = await(loop.events(Sid, from))
    payloadTypes(rows) shouldBe Nil
    val task = rows.find(r => payloadType(r) == "TaskUpdated").get
    task.seq shouldBe 0L
    payloadString(task, "taskId") shouldBe "cmp-1"

  test("session/title is not an EventRow; onTitle fires"):
    val remote = FakeClient()
    var titles = Vector.empty[(String, String)]
    val loop = DshLoop(remote, _ => Cwd, onTitle = (s, t) => titles = titles :+ (s -> t))
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("session/title", 1, """{"title":"Fix the parser","messageSeqs":[],"source":{"kind":"fallback"}}"""))
    payloadTypes(await(loop.events(Sid, 0))) should not contain "session/title"
    titles shouldBe Vector(Sid -> "Fix the parser")

  test("session-conflict create → Rejected; no Binding"):
    val remote = FakeClient()
    remote.create =
      Json.obj("ok" -> Json.False, "error" -> Json.obj("code" -> "session-conflict".asJson, "message" -> "cwd".asJson))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi"))) shouldBe Admit.Rejected("session-conflict")
    methods(remote) shouldBe List("session.create")
    await(loop.events(Sid, 0)) shouldBe Nil

  test("second Fast sessionId creates with the same cwd"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi"))) shouldBe Admit.Accepted(s"$Sid:c1")
    val other = AgentAttachProtocol.Command.SubmitUserMessage("sess-2", "c1", "yo")
    await(loop.submit(other)) shouldBe Admit.Accepted("sess-2:c1")
    val creates = remote.calls.filter(_._1 == "session.create")
    creates.map(c => createSessionId(c._2)) shouldBe List(Sid, "sess-2")
    creates.map(c => createCwd(c._2)) shouldBe List(Cwd, Cwd)
    methods(remote).count(_ == "workspace.create") shouldBe 0

  test("cancel matching live run; mismatch Rejected"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    await(loop.cancel(AgentAttachProtocol.Command.CancelRun(Sid, "nope", "x"))) shouldBe Admit.Rejected("no live run")
    methods(remote) should not contain "session.cancel"
    await(loop.cancel(AgentAttachProtocol.Command.CancelRun(Sid, s"$Sid:c1", "x"))) shouldBe Admit.Accepted(s"$Sid:c1")
    methods(remote).count(_ == "session.cancel") shouldBe 1
    payloadTypes(await(loop.events(Sid, 0))) shouldBe List("RunCancelled")
    await(loop.submit(submit("c2", "again"))) shouldBe Admit.Accepted(s"$Sid:c2")

  test("cancel RPC failure keeps the live run"):
    val remote = FakeClient()
    remote.cancel = Json.obj("ok" -> Json.False, "error" -> Json.obj("code" -> "agent-busy".asJson))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    await(loop.cancel(AgentAttachProtocol.Command.CancelRun(Sid, s"$Sid:c1", "x"))) shouldBe
      Admit.Rejected("agent-busy")
    await(loop.submit(submit("c2", "again"))) shouldBe Admit.Steered(s"$Sid:c1")

  test("question/requested lands QuestionBatchRequested; answer posts envelope rpcId; resolved waits for mux"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitQuestion(
      Sid,
      "rpc-q",
      Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson, "options" -> Json.arr(Json.obj("label" -> "Yes".asJson))))
    )
    payloadTypes(await(loop.events(Sid, 0))) should contain("QuestionBatchRequested")
    loop.busy(Sid) shouldBe true
    val answered = await(
      loop.answer(
        AgentAttachProtocol.Command.AnswerQuestionBatch(
          Sid,
          "rpc-q",
          List(AgentAttachProtocol.Command.QuestionBatchAnswer("q1", List("Yes")))
        )
      )
    )
    answered.status shouldBe "accepted"
    remote.replies.map(_._1) shouldBe Vector("rpc-q")
    remote.replies.head._2.hcursor.downField("answer").downField("answers").as[List[Json]].toOption.get.head
      .hcursor.get[String]("id").toOption.get shouldBe "q1"
    payloadTypes(await(loop.events(Sid, 0))) should not contain "QuestionBatchResolved"
    remote.emitQuestionDone(Sid, "rpc-q", "answered")
    payloadTypes(await(loop.events(Sid, 0))) should contain("QuestionBatchResolved")
    loop.busy(Sid) shouldBe true

  test("same question rpcId replay emits again; unknown rpc rejected; cancel uses replyCancel"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    val qs = Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson))
    remote.emitQuestion(Sid, "rpc-q", qs)
    remote.emitQuestion(Sid, "rpc-q", qs)
    payloadTypes(await(loop.events(Sid, 0))).count(_ == "QuestionBatchRequested") shouldBe 2
    await(loop.answer(AgentAttachProtocol.Command.AnswerQuestionBatch(Sid, "missing", Nil))) shouldBe
      RouteResult("rejected", "", "no pending question")
    await(loop.answer(AgentAttachProtocol.Command.AnswerQuestionBatch(Sid, "rpc-q", Nil, cancelled = true))).status shouldBe
      "accepted"
    remote.cancels shouldBe Vector("rpc-q")

  test("caps: question false, the rest true"):
    DshLoop(FakeClient(), _ => Cwd).caps shouldBe Caps(cancel = true, approval = true, question = false, restore = true)

  test("bind emits dsh_caps with five explicit keys"):
    val loop = DshLoop(FakeClient(), _ => Cwd)
    await(loop.bind(Sid, Cwd)) shouldBe Right(())
    val rows = await(loop.events(Sid, 0))
    liveTypes(rows) shouldBe Set("dsh_caps")
    DshSnapshotTypes shouldBe Set("dsh_caps", "dsh_queue")
    val caps = rows.find(r => payloadType(r) == "dsh_caps").get
    caps.seq shouldBe 0L
    val p = parse(caps.envelopeJson).toOption.get.hcursor.downField("payload")
    p.get[Boolean]("question").toOption.get shouldBe true
    p.get[Boolean]("slash").toOption.get shouldBe true
    p.get[Boolean]("queue").toOption.get shouldBe true
    p.get[Boolean]("goal").toOption.get shouldBe true
    p.get[Boolean]("budget").toOption.get shouldBe false
    p.keys.map(_.toSet).get shouldBe Set("type", "sessionId", "queue", "goal", "budget", "question", "slash")

  test("dsh_caps last-wins; FastLoop events have no dsh_*"):
    val loop = DshLoop(FakeClient(), _ => Cwd)
    await(loop.bind(Sid, Cwd))
    await(loop.bind(Sid, Cwd))
    await(loop.events(Sid, 0)).count(r => payloadType(r) == "dsh_caps") shouldBe 1
    await(DummyLoop().events("s", 0)).exists(r => payloadType(r).startsWith("dsh_")) shouldBe false

  test("DshSteer prompts mode=steer; DshQueue calls session.updateQueue"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "one")))
    await(loop.steer(AgentAttachProtocol.Command.DshSteer(Sid, "nudge"))) shouldBe Admit.Steered(s"$Sid:c1")
    remote.calls.filter(_._1 == "session.prompt").map(c => modeOf(c._2)).last shouldBe "steer"
    await(loop.queue(AgentAttachProtocol.Command.DshQueue(Sid, "m1", "remove"))).status shouldBe "accepted"
    methods(remote) should contain("session.updateQueue")

  test("session/queue snapshot is seq=0 last-wins; empty array still emits"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.bind(Sid, Cwd))
    remote.emitMux(
      Json.obj(
        "type" -> "session/queue".asJson,
        "sessionId" -> Sid.asJson,
        "items" -> Json.arr(
          Json.obj(
            "id" -> "a".asJson,
            "placement" -> "queued".asJson,
            "message" -> Json.obj("content" -> Json.arr(Json.obj("type" -> "text".asJson, "text" -> "one".asJson)))
          ),
          Json.obj("id" -> "b".asJson, "placement" -> "steering".asJson, "text" -> "two".asJson)
        )
      )
    )
    val first = await(loop.events(Sid, 0)).filter(r => payloadType(r) == "dsh_queue")
    first should have size 1
    first.head.seq shouldBe 0L
    remote.emitMux(Json.obj("type" -> "session/queue".asJson, "sessionId" -> Sid.asJson, "items" -> Json.arr()))
    val again = await(loop.events(Sid, 0)).filter(r => payloadType(r) == "dsh_queue")
    again should have size 1
    parse(again.head.envelopeJson).toOption.get.hcursor.downField("payload").downField("items").as[List[Json]].toOption.get shouldBe Nil

  test("images Nil is one text part; png adds image part; over imageLimits rejects without prompt"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    val content = remote.calls.filter(_._1 == "session.prompt").last._2.hcursor.downField("content").as[List[Json]].toOption.get
    content should have size 1
    content.head.hcursor.get[String]("type").toOption.get shouldBe "text"
    remote.emitMux(
      Json.obj(
        "type" -> "session/projection".asJson,
        "sessionId" -> Sid.asJson,
        "key" -> "imageLimits".asJson,
        "value" -> Json.obj("maxCount" -> 0.asJson, "maxBytes" -> 10.asJson)
      )
    )
    val png = AgentAttachProtocol.SubmitImage("image/png", "a" * 40)
    await(loop.submit(submit("c2", "pic").copy(images = List(png)))) shouldBe Admit.Rejected("imageLimits")
    methods(remote).count(_ == "session.prompt") shouldBe 1
    remote.emitMux(
      Json.obj(
        "type" -> "session/projection".asJson,
        "sessionId" -> Sid.asJson,
        "key" -> "imageLimits".asJson,
        "value" -> Json.obj("maxCount" -> 4.asJson, "maxBytes" -> 100000.asJson)
      )
    )
    await(loop.steer(AgentAttachProtocol.Command.DshSteer(Sid, "see", List(png)))).status shouldBe "steered"
    val parts = remote.calls.filter(_._1 == "session.prompt").last._2.hcursor.downField("content").as[List[Json]].toOption.get
    parts.map(_.hcursor.get[String]("type").toOption.get) shouldBe List("text", "image")
    parts.last.hcursor.get[String]("data").toOption.get shouldBe png.data

  test("projection tokenUsage does not emit dsh_usage"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitMux(
      Json.obj(
        "type" -> "session/projection".asJson,
        "sessionId" -> Sid.asJson,
        "key" -> "tokenUsage".asJson,
        "value" -> Json.obj("input" -> 1.asJson)
      )
    )
    await(loop.events(Sid, 0)).map(payloadType) should not contain "dsh_usage"

  test("emitHost agent-error becomes error row; session-added is dropped"):
    val remote = FakeClient()
    var errors = Vector.empty[(String, String)]
    val loop = DshLoop(remote, _ => Cwd, onError = (s, m) => errors = errors :+ (s -> m))
    await(loop.bind(Sid, Cwd))
    remote.emitHost(Json.obj("type" -> "host/agent-error".asJson, "sessionId" -> Sid.asJson, "message" -> "boom".asJson))
    payloadTypes(await(loop.events(Sid, 0))) should contain("error")
    errors shouldBe Vector(Sid -> "boom")
    remote.emitHost(Json.obj("type" -> "host/session-added".asJson, "sessionId" -> "other".asJson, "blank" -> Json.True))
    payloadTypes(await(loop.events(Sid, 0))) should not contain "host/session-added"
    payloadTypes(await(loop.events("other", 0))) shouldBe Nil

  test("emitHost agent-error during a live run stays on the river and does not idle-push"):
    val remote = FakeClient()
    var errors = 0
    val loop = DshLoop(remote, _ => Cwd, onError = (_, _) => errors += 1)
    await(loop.submit(submit("c1", "hi")))
    remote.emitHost(Json.obj("type" -> "host/agent-error".asJson, "sessionId" -> Sid.asJson, "message" -> "boom".asJson))
    payloadTypes(await(loop.events(Sid, 0))) should contain("error")
    errors shouldBe 0

  test("session/jobs maps to TaskUpdated; empty list settles; no dsh_jobs"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.bind(Sid, Cwd))
    remote.emitMux(
      Json.obj(
        "type" -> "session/jobs".asJson,
        "sessionId" -> Sid.asJson,
        "jobs" -> Json.arr(Json.obj("id" -> "bash-1".asJson, "kind" -> "bash".asJson, "label" -> "ls".asJson, "status" -> "running".asJson))
      )
    )
    val rows = await(loop.events(Sid, 0))
    val job = rows.find(r => payloadType(r) == "TaskUpdated").get
    job.seq shouldBe 0L
    liveTypes(rows) should contain("TaskUpdated")
    DshSnapshotTypes should not contain "TaskUpdated"
    rows.map(payloadType) should not contain "dsh_jobs"
    payloadString(job, "taskId") shouldBe "bash-1"
    payloadString(job, "taskId") should not startWith "dsh-compaction:"
    payloadString(job, "taskId") should not startWith "cmp-"
    remote.emitMux(Json.obj("type" -> "session/jobs".asJson, "sessionId" -> Sid.asJson, "jobs" -> Json.arr()))
    val settled = await(loop.events(Sid, 0)).find(r => payloadType(r) == "TaskUpdated").get
    payloadString(settled, "status") shouldBe "done"

  test("jobs TaskUpdated does not occupy a river seq"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emitMux(
      Json.obj(
        "type" -> "session/jobs".asJson,
        "sessionId" -> Sid.asJson,
        "jobs" -> Json.arr(Json.obj("id" -> "bash-1".asJson, "kind" -> "bash".asJson, "status" -> "running".asJson))
      )
    )
    remote.emit(Sid, chunk(2, "Hi"))
    await(loop.events(Sid, 0)).filter(_.seq > 0).map(_.seq) shouldBe List(1L, 2L)

  test("compaction TaskUpdated does not occupy a river seq"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, ev("compaction/start", 2, """{"compactionId":"cmp-1","turn":1}"""))
    remote.emit(Sid, chunk(3, "Hi"))
    val rows = await(loop.events(Sid, 0))
    rows.filter(_.seq > 0).map(_.seq) shouldBe List(1L, 2L)
    val task = rows.find(r => payloadType(r) == "TaskUpdated").get
    task.seq shouldBe 0L
    payloadString(task, "kind") shouldBe "compaction"
    payloadString(task, "taskId") shouldBe "cmp-1"

  test("no turn budget source does not cancel"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, ev("turn/start", 2, """{"turn":2}"""))
    methods(remote) should not contain "session.cancel"

  test("honest maxTurns cancels after N turn/start"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd, maxTurns = Some(2))
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    methods(remote) should not contain "session.cancel"
    remote.emit(Sid, ev("turn/start", 2, """{"turn":2}"""))
    methods(remote) should contain("session.cancel")

  test("known tool has no dsh_tool_card; unknown emits card plus ToolStarted"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, ev("tool/call", 2, """{"callId":"c-bash","name":"bash","arguments":"{}"}"""))
    payloadTypes(await(loop.events(Sid, 0))) should contain("ToolStarted")
    await(loop.events(Sid, 0)).map(payloadType) should not contain "dsh_tool_card"
    remote.emit(Sid, ev("tool/call", 3, """{"callId":"c-x","name":"web_search","arguments":"{}"}"""))
    val types = payloadTypes(await(loop.events(Sid, 0)))
    types should contain("dsh_tool_card")
    types should contain("ToolStarted")
    val card = await(loop.events(Sid, 0)).find(r => payloadType(r) == "dsh_tool_card").get
    card.envelopeJson should not include "\"view\""
    card.envelopeJson should not include "cardKind"

  test("goal/change emits dsh_goal_changed not GoalUpdated"):
    val remote = FakeClient()
    var goals = Vector.empty[(String, String, String)]
    val loop = DshLoop(remote, _ => Cwd, onGoal = (s, op, phase, title, _) => goals = goals :+ (s, op, title))
    await(loop.bind(Sid, Cwd))
    remote.emit(Sid, ev("goal/change", 1, """{"operation":"create","goal":{"phase":"active","title":"Ship"}}"""))
    val types = await(loop.events(Sid, 0)).map(payloadType)
    types should contain("dsh_goal_changed")
    types should not contain "GoalUpdated"
    goals shouldBe Vector((Sid, "create", "Ship"))

  test("goal/change during a live run stays on the river and does not idle-push"):
    val remote = FakeClient()
    var goals = 0
    val loop = DshLoop(remote, _ => Cwd, onGoal = (_, _, _, _, _) => goals += 1)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("goal/change", 1, """{"operation":"create","goal":{"phase":"active","title":"Ship"}}"""))
    await(loop.events(Sid, 0)).map(payloadType) should contain("dsh_goal_changed")
    goals shouldBe 0

  test("busy: live run or pending approval; idle after turn/end"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    loop.busy(Sid) shouldBe false
    await(loop.submit(submit("c1", "hi")))
    loop.busy(Sid) shouldBe true
    remote.emit(Sid, ev("turn/end", 1, """{"turn":1,"reason":{"kind":"completed"}}"""))
    loop.busy(Sid) shouldBe false
    remote.emitAsked(Sid, "rpc-b", "ap-b", "bash")
    loop.busy(Sid) shouldBe true
    remote.emitDone(Sid, "ap-b", "allowed-once")
    loop.busy(Sid) shouldBe false
    remote.emitQuestion(
      Sid,
      "rpc-q",
      Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson))
    )
    loop.busy(Sid) shouldBe true
    remote.emitQuestionDone(Sid, "rpc-q", "answered")
    loop.busy(Sid) shouldBe false

  test("onTurnBegin runs before prompt; failure still prompts"):
    val remote = FakeClient()
    var began = Vector.empty[String]
    val loop = DshLoop(
      remote,
      _ => Cwd,
      onTurnBegin = (_, r) =>
        began = began :+ r
        Future.failed(RuntimeException("held"))
    )
    await(loop.submit(submit("c1", "hi"))) shouldBe Admit.Accepted(s"$Sid:c1")
    methods(remote) should contain("session.prompt")
    began shouldBe Vector(s"$Sid:c1")
    loop.busy(Sid) shouldBe true

  test("onTurnEnd fires on turn/end; steer does not begin again; prompt failure still ends"):
    val remote = FakeClient()
    var begin = 0
    var ended = Vector.empty[(String, Vector[String])]
    val loop = DshLoop(
      remote,
      _ => Cwd,
      onTurnBegin = (_, _) =>
        begin += 1
        Future.unit
      ,
      onTurnEnd = (_, r, ids) =>
        ended = ended :+ (r -> ids)
        Future.unit
    )
    await(loop.submit(submit("c1", "one"))) shouldBe Admit.Accepted(s"$Sid:c1")
    begin shouldBe 1
    await(loop.submit(submit("c2", "two"))) shouldBe Admit.Steered(s"$Sid:c1")
    begin shouldBe 1
    remote.emit(Sid, ev("turn/end", 1, """{"turn":1,"reason":{"kind":"completed"}}"""))
    ended.map(_._1) shouldBe Vector(s"$Sid:c1")
    await(loop.submit(submit("c3", "next"))) shouldBe Admit.Accepted(s"$Sid:c3")
    begin shouldBe 2
    remote.emit(Sid, ev("turn/end", 2, """{"turn":1,"reason":{"kind":"completed"}}"""))
    ended.map(_._1) shouldBe Vector(s"$Sid:c1", s"$Sid:c3")
    remote.prompt = Json.obj("ok" -> Json.False, "error" -> Json.obj("code" -> "agent-busy".asJson))
    await(loop.submit(submit("c4", "fail"))) shouldBe Admit.Rejected("agent-busy")
    ended.map(_._1) shouldBe Vector(s"$Sid:c1", s"$Sid:c3", s"$Sid:c4")

  test("next submit waits until onTurnEnd completes"):
    val remote = FakeClient()
    val gate = Promise[Unit]()
    var begin = 0
    val loop = DshLoop(
      remote,
      _ => Cwd,
      onTurnBegin = (_, _) =>
        begin += 1
        Future.unit
      ,
      onTurnEnd = (_, _, _) => gate.future
    )
    await(loop.submit(submit("c1", "one")))
    begin shouldBe 1
    remote.emit(Sid, ev("turn/end", 1, """{"turn":1,"reason":{"kind":"completed"}}"""))
    loop.busy(Sid) shouldBe true
    val next = loop.submit(submit("c2", "two"))
    begin shouldBe 1
    next.isCompleted shouldBe false
    gate.success(())
    val admit = await(next)
    admit shouldBe Admit.Accepted(s"$Sid:c2")
    admit should not be a[Admit.Queued]
    dshQueuedOnto(Some(s"$Sid:c1"), s"$Sid:c2") shouldBe false
    begin shouldBe 2
    loop.busy(Sid) shouldBe true

  test("cancel during onTurnBegin does not prompt and still ends"):
    val remote = FakeClient()
    val gate = Promise[Unit]()
    val started = Promise[Unit]()
    var ended = Vector.empty[String]
    val loop = DshLoop(
      remote,
      _ => Cwd,
      onTurnBegin = (_, _) =>
        started.success(())
        gate.future
      ,
      onTurnEnd = (_, r, _) =>
        ended = ended :+ r
        Future.unit
    )
    val pending = loop.submit(submit("c1", "hi"))
    await(started.future)
    await(loop.cancel(AgentAttachProtocol.Command.CancelRun(Sid, s"$Sid:c1", "x"))) shouldBe
      Admit.Accepted(s"$Sid:c1")
    gate.success(())
    await(pending) shouldBe Admit.Rejected("cancelled")
    methods(remote) should not contain "session.prompt"
    ended should contain(s"$Sid:c1")
    loop.busy(Sid) shouldBe false

  test("onTurnEnd receives tool/call ids collected during the live run"):
    val remote = FakeClient()
    var ended = Vector.empty[Vector[String]]
    val loop = DshLoop(
      remote,
      _ => Cwd,
      onTurnEnd = (_, _, ids) =>
        ended = ended :+ ids
        Future.unit
    )
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(
      Sid,
      ev("tool/call", 2, """{"turn":1,"step":1,"callId":"call-1","name":"bash","arguments":"{}"}""")
    )
    remote.emit(
      Sid,
      ev("tool/call", 3, """{"turn":1,"step":2,"callId":"call-2","name":"edit","arguments":"{}"}""")
    )
    remote.emit(Sid, ev("turn/end", 4, """{"turn":1,"reason":{"kind":"completed"}}"""))
    ended shouldBe Vector(Vector("call-1", "call-2"))

  test("engine switch rejects while DSH is busy; idle apply; liveRun feeds CancelSession"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    val avail = Set(EngineId.Fast, EngineId("dsh"))
    loop.liveRun(Sid) shouldBe None
    EngineIds.switch("fast", isEngineBusy(false, loop.busy(Sid), loop.busy(Sid)), avail) shouldBe
      EngineSwitch.Apply(Some("fast"))
    await(loop.submit(submit("c1", "hi")))
    loop.liveRun(Sid) shouldBe Some(s"$Sid:c1")
    EngineIds.switch("fast", isEngineBusy(false, loop.busy(Sid), loop.busy(Sid)), avail) shouldBe
      EngineSwitch.Rejected("busy")
    EngineIds.switch("dsh", isEngineBusy(false, false, loop.busy(Sid)), avail) shouldBe
      EngineSwitch.Rejected("busy")
    remote.emit(Sid, ev("turn/end", 1, """{"turn":1,"reason":{"kind":"completed"}}"""))
    loop.liveRun(Sid) shouldBe None
    EngineIds.switch("fast", isEngineBusy(false, loop.busy(Sid), loop.busy(Sid)), avail) shouldBe
      EngineSwitch.Apply(Some("fast"))

  test("approval asked → card; decide posts envelope rpcId; river waits for mux resolved"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitAsked(Sid, "rpc-1", "ap-1", "bash", Some("sandbox"), Some("call-9"))
    val asked = await(loop.events(Sid, 0)).last
    payloadType(asked) shouldBe "ApprovalRequested"
    payloadString(asked, "tool") shouldBe "shell"
    payloadString(asked, "risk") shouldBe "shell"
    payloadString(asked, "description") shouldBe "sandbox"
    payloadString(asked, "context") shouldBe ""
    payloadString(asked, "note") shouldBe "sandbox"
    payloadString(asked, "runId") shouldBe s"$Sid:c1"
    await(loop.decide(AgentAttachProtocol.Command.DecideApproval(Sid, s"$Sid:c1", "ap-1", approved = true))) shouldBe
      RouteResult("accepted", s"$Sid:c1", "")
    remote.replies should have size 1
    remote.replies.head._1 shouldBe "rpc-1"
    remote.replies.head._2.hcursor.get[String]("outcome").toOption.get shouldBe "allowed-once"
    payloadTypes(await(loop.events(Sid, 0))).count(_ == "ApprovalResolved") shouldBe 0
    remote.emitDone(Sid, "ap-1", "allowed-once")
    payloadTypes(await(loop.events(Sid, 0))).last shouldBe "ApprovalResolved"
    await(loop.decide(AgentAttachProtocol.Command.DecideApproval(Sid, s"$Sid:c1", "ap-1", approved = false))) shouldBe
      RouteResult("rejected", "", "no pending approval")

  test("write outside workspace uses external_directory and file_path, never callId"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(
      Sid,
      ev(
        "tool/call",
        1,
        """{"turn":1,"callId":"call-w","name":"write","arguments":"{\"file_path\":\"/tmp/out.txt\",\"content\":\"hi\"}"}"""
      )
    )
    remote.emitAsked(
      Sid,
      "rpc-w",
      "ap-w",
      "write",
      Some("escalate sandbox to danger-full-access: absolute path outside the session workspace"),
      Some("call-w")
    )
    val asked = await(loop.events(Sid, 0)).last
    payloadString(asked, "tool") shouldBe "write_file"
    payloadString(asked, "risk") shouldBe "external_directory"
    payloadString(asked, "context") shouldBe "/tmp/out.txt"
    payloadString(asked, "description") should include("outside")
    payloadString(asked, "note") should include("outside")

  test("write without escalate is workspace_write; missing tool/call leaves context empty"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitAsked(Sid, "rpc-w2", "ap-w2", "write", Some("write a file"), Some("call-missing"))
    val asked = await(loop.events(Sid, 0)).last
    payloadString(asked, "tool") shouldBe "write_file"
    payloadString(asked, "risk") shouldBe "workspace_write"
    payloadString(asked, "context") shouldBe ""
    payloadString(asked, "description") shouldBe "write a file"
    payloadString(asked, "note") shouldBe "write a file"

  test("unknown approvalId does not respond"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    await(loop.decide(AgentAttachProtocol.Command.DecideApproval(Sid, s"$Sid:c1", "ghost", approved = true))) shouldBe
      RouteResult("rejected", "", "no pending approval")
    remote.replies shouldBe empty

  test("decide reject maps to DSH rejected; cancelled mux expires the card"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitAsked(Sid, "rpc-2", "ap-2", "write")
    await(loop.decide(AgentAttachProtocol.Command.DecideApproval(Sid, s"$Sid:c1", "ap-2", approved = false)))
      .status shouldBe "accepted"
    remote.replies.head._2.hcursor.get[String]("outcome").toOption.get shouldBe "rejected"
    remote.emitDone(Sid, "ap-2", "cancelled")
    payloadString(await(loop.events(Sid, 0)).last, "type") shouldBe "ApprovalExpired"
    payloadString(await(loop.events(Sid, 0)).last, "reason") shouldBe "cancelled"

  test("replay of the same approvalId updates rpcId and does not duplicate the card"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitAsked(Sid, "rpc-old", "ap-3", "bash")
    remote.emitAsked(Sid, "rpc-new", "ap-3", "bash")
    payloadTypes(await(loop.events(Sid, 0))).count(_ == "ApprovalRequested") shouldBe 1
    await(loop.decide(AgentAttachProtocol.Command.DecideApproval(Sid, s"$Sid:c1", "ap-3", approved = true)))
    remote.replies.map(_._1) shouldBe Vector("rpc-new")

  test("respond not-pending stays pending until mux resolved"):
    val remote = FakeClient()
    remote.replyFail = Some("not-pending")
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitAsked(Sid, "rpc-4", "ap-4", "bash")
    await(loop.decide(AgentAttachProtocol.Command.DecideApproval(Sid, s"$Sid:c1", "ap-4", approved = true))) shouldBe
      RouteResult("rejected", "", "not-pending")
    payloadTypes(await(loop.events(Sid, 0))).count(_ == "ApprovalResolved") shouldBe 0

  test("restore text history is not an empty Attach window"):
    val remote = FakeClient()
    remote.history = historyOf("text-turn.jsonl")
    val loop = DshLoop(remote, _ => Cwd)
    val page = await(loop.restore(Sid, None, 20))
    page.rows should not be empty
    page.rows.map(r => (r.role, r.content.getOrElse(""))) shouldBe List(
      ("user", "hi"),
      ("assistant", "think"),
      ("assistant", "Hello")
    )
    methods(remote) should contain("session.history")
    methods(remote) should contain("subagent.list")
    await(loop.submit(submit("c1", "again"))) shouldBe Admit.Accepted(s"$Sid:c1")
    methods(remote) should not contain "workspace.create"
    methods(remote) should contain("session.create")
    createCwd(remote.calls.find(_._1 == "session.create").get._2) shouldBe Cwd

  test("restore fills child history; parent rows stay linear"):
    val remote = FakeClient()
    remote.history = historyOf("text-turn.jsonl")
    remote.list = catalog(childEntry("child-1", "inactive", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    val page = await(loop.restore(Sid, None, 20))
    methods(remote) should contain("subagent.history")
    remote.calls.filter(_._1 == "subagent.history").map(_._2.hcursor.get[String]("sessionId").toOption.get) shouldBe
      List("child-1")
    page.rows.map(_.sessionId).distinct shouldBe List(Sid)
    page.rows.flatMap(_.content) should not contain "child-secret"
    page.rows.head.productArity shouldBe 15

  test("restore tools + open todo Plan; compaction stays out; title via onTitle"):
    val remote = FakeClient()
    remote.history = historyOf("restore-todo-open.jsonl")
    var titles = Vector.empty[(String, String)]
    val loop = DshLoop(remote, _ => Cwd, onTitle = (s, t) => titles = titles :+ (s -> t))
    val page = await(loop.restore(Sid, None, 20))
    page.rows.map(_.messageType) should contain("plan")
    page.rows.find(_.messageType == "plan").get.payloadJson.get should include("read the file")
    titles shouldBe Vector(Sid -> "Fix the parser")

  test("restore skips compaction events"):
    val remote = FakeClient()
    remote.history = historyOf("restore-compaction.jsonl")
    val page = await(DshLoop(remote, _ => Cwd).restore(Sid, None, 20))
    page.rows.map(_.messageType) should not contain "compaction"
    page.rows.map(_.content.getOrElse("")) shouldBe List("hi", "Hello")

  test("todo cleared by turn/start has no Plan card"):
    val remote = FakeClient()
    remote.history = historyOf("restore-todo-cleared.jsonl")
    val page = await(DshLoop(remote, _ => Cwd).restore(Sid, None, 20))
    page.rows.map(_.messageType) should not contain "plan"

  test("session-not-found restore is an empty window"):
    val remote = FakeClient()
    remote.history = Json.obj("ok" -> Json.False, "error" -> Json.obj("code" -> "session-not-found".asJson))
    val page = await(DshLoop(remote, _ => Cwd).restore(Sid, None, 20))
    page.rows shouldBe Nil
    page.totalExchangeCount shouldBe 0

  test("history internal error fails restore"):
    val remote = FakeClient()
    remote.history = Json.obj("ok" -> Json.False, "error" -> Json.obj("code" -> "internal".asJson))
    intercept[RuntimeException]:
      await(DshLoop(remote, _ => Cwd).restore(Sid, None, 20))

  test("list backfill emits Started and Updated not Finished"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "inactive", "one-shot", "explore"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    payloadTypes(await(loop.events(Sid, 0))) shouldBe List("SubagentStarted", "SubagentUpdated")
    payloadTypes(await(loop.events(Sid, 0))) should not contain "SubagentFinished"
    payloadString(await(loop.events(Sid, 0)).last, "activity") shouldBe "inactive"

  test("second catalog list does not re-emit Updated"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "inactive", "one-shot", "explore"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    val first = payloadTypes(await(loop.events(Sid, 0))).count(_ == "SubagentUpdated")
    first shouldBe 1
    remote.emitSubscribed(Sid, 0)
    payloadTypes(await(loop.events(Sid, 0))).count(_ == "SubagentUpdated") shouldBe 1

  test("stale inactive catalog does not clobber a running child"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit("child-1", ev("turn/start", 1, """{"turn":1}"""))
    remote.list = catalog(childEntry("child-1", "inactive", "continuable", "bg"))
    remote.emitSubscribed(Sid, 0)
    payloadString(await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated").last, "activity") shouldBe
      "running"
    loop.childOpen(Sid) shouldBe true

  test("tool/call during in-flight list triggers another list"):
    val remote = FakeClient()
    val hold = Promise[Json]()
    remote.listHold = Some(hold)
    val loop = DshLoop(remote, _ => Cwd)(using ExecutionContext.parasitic)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    methods(remote).count(_ == "subagent.list") shouldBe 1
    remote.emit(Sid, ev("tool/call", 2, """{"name":"subagent"}"""))
    remote.listHold = None
    remote.list = catalog(childEntry("child-1", "inactive", "one-shot", "explore"))
    hold.success(catalog())
    methods(remote).count(_ == "subagent.list") shouldBe 2
    payloadTypes(await(loop.events(Sid, 0))) should contain("SubagentStarted")

  test("unknown child sid registers and replays the triggering frame"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "inactive", "continuable", "explore"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit("child-1", ev("turn/start", 1, """{"turn":1}"""))
    val types = payloadTypes(await(loop.events(Sid, 0)))
    types should contain("SubagentStarted")
    types should contain("SubagentUpdated")
    payloadString(await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated").last, "activity") shouldBe
      "running"

  test("unknown child sid replays after async list"):
    val remote = FakeClient()
    val hold = Promise[Json]()
    remote.listHold = Some(hold)
    val loop = DshLoop(remote, _ => Cwd)(using ExecutionContext.parasitic)
    await(loop.submit(submit("c1", "hi")))
    remote.emit("child-1", ev("turn/start", 1, """{"turn":1}"""))
    payloadTypes(await(loop.events(Sid, 0))).exists(_.startsWith("Subagent")) shouldBe false
    hold.success(catalog(childEntry("child-1", "inactive", "continuable", "explore")))
    val types = payloadTypes(await(loop.events(Sid, 0)))
    types should contain("SubagentStarted")
    payloadString(await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated").last, "activity") shouldBe
      "running"

  test("child question on unknown sid waits for list"):
    val remote = FakeClient()
    val hold = Promise[Json]()
    remote.listHold = Some(hold)
    val loop = DshLoop(remote, _ => Cwd)(using ExecutionContext.parasitic)
    await(loop.submit(submit("c1", "hi")))
    remote.emitQuestion(
      "child-1",
      "rpc-q",
      Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson, "options" -> Json.arr(Json.obj("label" -> "Yes".asJson))))
    )
    payloadTypes(await(loop.events(Sid, 0))) should not contain "QuestionBatchRequested"
    hold.success(catalog(childEntry("child-1", "running", "continuable", "bg")))
    payloadTypes(await(loop.events(Sid, 0))) should contain("QuestionBatchRequested")
    await(
      loop.answer(
        AgentAttachProtocol.Command.AnswerQuestionBatch(
          Sid,
          "rpc-q",
          List(AgentAttachProtocol.Command.QuestionBatchAnswer("q1", List("Yes")))
        )
      )
    ).status shouldBe "accepted"
    remote.replies.head._2.hcursor.get[String]("sessionId").toOption.get shouldBe "child-1"

  test("list failure clears listing so another unknown can list"):
    val remote = FakeClient()
    val hold = Promise[Json]()
    remote.listHold = Some(hold)
    val loop = DshLoop(remote, _ => Cwd)(using ExecutionContext.parasitic)
    await(loop.submit(submit("c1", "hi")))
    remote.emit("ghost-1", ev("turn/start", 1, """{"turn":1}"""))
    methods(remote).count(_ == "subagent.list") shouldBe 1
    hold.failure(RuntimeException("boom"))
    remote.listHold = None
    remote.emit("ghost-2", ev("turn/start", 2, """{"turn":1}"""))
    methods(remote).count(_ == "subagent.list") shouldBe 2

  test("restore parent lists an unknown child sid"):
    val remote = FakeClient()
    remote.history = Json.obj("ok" -> Json.True, "value" -> Json.obj("events" -> Json.arr(), "hasMore" -> Json.False))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.restore(Sid, None, 20))
    remote.list = catalog(childEntry("child-1", "inactive", "continuable", "bg"))
    remote.emit("child-1", ev("turn/start", 1, """{"turn":1}"""))
    payloadTypes(await(loop.events(Sid, 0))) should contain("SubagentStarted")

  test("in-flight stale list does not miss-cache a later unknown sid"):
    val remote = FakeClient()
    val hold = Promise[Json]()
    remote.listHold = Some(hold)
    val loop = DshLoop(remote, _ => Cwd)(using ExecutionContext.parasitic)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit("child-1", ev("turn/start", 1, """{"turn":1}"""))
    methods(remote).count(_ == "subagent.list") shouldBe 1
    remote.listHold = None
    remote.list = catalog(childEntry("child-1", "inactive", "continuable", "bg"))
    hold.success(catalog())
    payloadTypes(await(loop.events(Sid, 0))) should contain("SubagentStarted")
    methods(remote).count(_ == "subagent.list") shouldBe 2

  test("list failure does not negatively cache the triggering sid"):
    val remote = FakeClient()
    val hold = Promise[Json]()
    remote.listHold = Some(hold)
    val loop = DshLoop(remote, _ => Cwd)(using ExecutionContext.parasitic)
    await(loop.submit(submit("c1", "hi")))
    remote.emit("ghost-1", ev("turn/start", 1, """{"turn":1}"""))
    hold.failure(RuntimeException("boom"))
    remote.listHold = None
    remote.emit("ghost-1", ev("turn/start", 2, """{"turn":1}"""))
    methods(remote).count(_ == "subagent.list") shouldBe 2

  test("unknown before parent bind lists after submit"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "inactive", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    remote.emit("child-1", ev("turn/start", 1, """{"turn":1}"""))
    payloadTypes(await(loop.events(Sid, 0))).exists(_.startsWith("Subagent")) shouldBe false
    await(loop.submit(submit("c1", "hi")))
    payloadTypes(await(loop.events(Sid, 0))) should contain("SubagentStarted")

  test("unknown sid miss is negatively cached for 2s"):
    var now = 0L
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd, nowMs = () => now)
    await(loop.submit(submit("c1", "hi")))
    remote.emit("ghost", ev("turn/start", 1, """{"turn":1}"""))
    remote.emit("ghost", ev("turn/start", 2, """{"turn":1}"""))
    methods(remote).count(_ == "subagent.list") shouldBe 1
    now = 2000L
    remote.emit("ghost", ev("turn/start", 3, """{"turn":1}"""))
    methods(remote).count(_ == "subagent.list") shouldBe 2

  test("child session.history is not folded through dshEvents"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "inactive", "one-shot"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    val before = methods(remote).count(_ == "session.history")
    remote.emitSubscribed("child-1", 4)
    methods(remote).count(_ == "session.history") shouldBe before
    payloadTypes(await(loop.events(Sid, 0))) should not contain "AssistantDelta"

  test("diagnostic catalog row stays off the river"):
    val remote = FakeClient()
    remote.list = catalog(
      Json.obj("kind" -> "diagnostic".asJson, "id" -> "bad".asJson, "reason" -> "corrupt".asJson)
    )
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    payloadTypes(await(loop.events(Sid, 0))).exists(_.startsWith("Subagent")) shouldBe false

  test("child lifecycle appends after parent liveRunId is cleared"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "inactive", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/end", 1, """{"turn":1,"reason":{"kind":"completed"}}"""))
    remote.emit("child-1", ev("turn/start", 2, """{"turn":1}"""))
    payloadTypes(await(loop.events(Sid, 0))) should contain("SubagentUpdated")
    payloadString(await(loop.events(Sid, 0)).last, "activity") shouldBe "running"

  test("one-shot turn/end emits Finished via dshEndStatus"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "one-shot", "explore"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit("child-1", ev("turn/end", 2, """{"turn":1,"reason":{"kind":"error"}}"""))
    val finished = await(loop.events(Sid, 0)).find(r => payloadType(r) == "SubagentFinished").get
    payloadString(finished, "status") shouldBe "failed"

  test("continuable turn/end does not emit Finished"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit("child-1", ev("turn/end", 2, """{"turn":1,"reason":{"kind":"completed"}}"""))
    val types = payloadTypes(await(loop.events(Sid, 0)))
    types should contain("SubagentUpdated")
    types should not contain "SubagentFinished"

  test("dshSettledStale is only true when the notice is older than the last start"):
    dshSettledStale(Some(20), Some(30)) shouldBe true
    dshSettledStale(Some(30), Some(20)) shouldBe false
    dshSettledStale(None, Some(30)) shouldBe false
    dshSettledStale(Some(20), None) shouldBe false

  test("idle parent subagent-settled idles a running continuable child"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/end", 1, """{"turn":1,"reason":{"kind":"completed"}}"""))
    remote.emit("child-1", ev("turn/start", 2, """{"turn":1}"""))
    loop.childOpen(Sid) shouldBe true
    remote.emit(Sid, userSource(3, "subagent-settled", "child-1"))
    val rows = await(loop.events(Sid, 0))
    payloadString(rows.filter(r => payloadType(r) == "SubagentUpdated").last, "activity") shouldBe "inactive"
    payloadTypes(rows) should not contain "SubagentFinished"
    loop.childOpen(Sid) shouldBe false

  test("late subagent-settled does not idle a newer child turn"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/end", 1, """{"turn":1,"reason":{"kind":"completed"}}"""))
    remote.emit("child-1", ev("turn/start", 2, """{"turn":1}""", time = 10))
    remote.emit("child-1", ev("turn/end", 3, """{"turn":1,"reason":{"kind":"completed"}}""", time = 15))
    remote.emit("child-1", ev("turn/start", 4, """{"turn":2}""", time = 30))
    loop.childOpen(Sid) shouldBe true
    remote.emit(Sid, userSource(5, "subagent-settled", "child-1", time = 20))
    payloadString(await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated").last, "activity") shouldBe
      "running"
    loop.childOpen(Sid) shouldBe true

  test("idle parent subagent-report does not idle a running child"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/end", 1, """{"turn":1,"reason":{"kind":"completed"}}"""))
    remote.emit("child-1", ev("turn/start", 2, """{"turn":1}"""))
    remote.emit(Sid, userSource(3, "subagent-report", "child-1"))
    payloadString(await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated").last, "activity") shouldBe
      "running"
    loop.childOpen(Sid) shouldBe true

  test("catalog inactive idles a started child whose mux turn is closed"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    loop.childOpen(Sid) shouldBe true
    remote.list = catalog(childEntry("child-1", "inactive", "continuable", "bg"))
    remote.emitSubscribed(Sid, 0)
    payloadString(await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated").last, "activity") shouldBe
      "inactive"
    payloadTypes(await(loop.events(Sid, 0))) should not contain "SubagentFinished"
    loop.childOpen(Sid) shouldBe false

  test("catalog running after idle is not clobbered by stale inactive"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit("child-1", ev("turn/start", 1, """{"turn":1}"""))
    remote.emit("child-1", ev("turn/end", 2, """{"turn":1,"reason":{"kind":"completed"}}"""))
    loop.childOpen(Sid) shouldBe false
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    remote.emitSubscribed(Sid, 0)
    loop.childOpen(Sid) shouldBe true
    remote.list = catalog(childEntry("child-1", "inactive", "continuable", "bg"))
    remote.emitSubscribed(Sid, 0)
    payloadString(await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated").last, "activity") shouldBe
      "running"
    loop.childOpen(Sid) shouldBe true

  test("child assistant and tool events never enter the parent river"):
    var now = 0L
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "one-shot"))
    val loop = DshLoop(remote, _ => Cwd, nowMs = () => now)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit("child-1", ev("tool/call", 3, """{"callId":"c1","name":"read","arguments":"{\"path\":\"src/A.scala\"}"}"""))
    now = 100L
    remote.emit("child-1", chunk(4, "Hello"))
    val rows = await(loop.events(Sid, 0))
    val types = payloadTypes(rows)
    types should not contain "AssistantDelta"
    types should not contain "ToolStarted"
    val preview = payloadOpt(rows.filter(r => payloadType(r) == "SubagentUpdated").last, "preview").get
    preview should not be empty
    preview should include("read_file")
    preview should include("src/A.scala")
    preview should include("Hello")

  test("child preview still appends after parent turn/end"):
    var now = 0L
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd, nowMs = () => now)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/end", 1, """{"turn":1,"reason":{"kind":"completed"}}"""))
    remote.emit("child-1", chunk(2, "still-running"))
    val preview = payloadOpt(
      await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated").last,
      "preview"
    ).get
    preview should include("still-running")

  test("turn/end at 50ms is not swallowed by preview throttle"):
    var now = 0L
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd, nowMs = () => now)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit("child-1", chunk(2, "hi"))
    now = 50L
    remote.emit("child-1", ev("turn/end", 3, """{"turn":1,"reason":{"kind":"completed"}}"""))
    val updated = await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated")
    updated.exists(r => payloadString(r, "activity") == "inactive") shouldBe true

  test("Hold after turn/end does not write activity back to running"):
    var now = 0L
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd, nowMs = () => now)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit("child-1", chunk(2, "hi"))
    now = 50L
    remote.emit("child-1", ev("turn/end", 3, """{"turn":1,"reason":{"kind":"completed"}}"""))
    remote.emit("child-1", chunk(4, "more"))
    val mid = await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated")
    payloadString(mid.last, "activity") shouldBe "inactive"
    now = 150L
    remote.emit("child-1", chunk(5, "!"))
    val last = await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated").last
    payloadString(last, "activity") shouldBe "inactive"
    payloadOpt(last, "preview").get shouldBe "himore!"

  test("preview deltas 50ms apart Hold; t=100 emits the merged tail"):
    var now = 0L
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "one-shot"))
    val loop = DshLoop(remote, _ => Cwd, nowMs = () => now)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit("child-1", chunk(2, "aa"))
    now = 50L
    remote.emit("child-1", chunk(3, "bb"))
    val mid = await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated")
    mid.map(r => payloadOpt(r, "preview").getOrElse("")) should not contain "aabb"
    now = 100L
    remote.emit("child-1", chunk(4, "cc"))
    val last = payloadOpt(
      await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated").last,
      "preview"
    ).get
    last shouldBe "aabbcc"

  test("continuable second turn/start clears preview"):
    var now = 0L
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd, nowMs = () => now)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit("child-1", ev("turn/start", 2, """{"turn":1}"""))
    now = 100L
    remote.emit("child-1", ev("tool/call", 3, """{"callId":"c1","name":"read","arguments":"{\"path\":\"src/A.scala\"}"}"""))
    now = 150L
    remote.emit("child-1", ev("turn/end", 4, """{"turn":1,"reason":{"kind":"completed"}}"""))
    payloadTypes(await(loop.events(Sid, 0))) should not contain "SubagentFinished"
    val afterEnd = payloadOpt(
      await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated").last,
      "preview"
    ).get
    afterEnd should include("read_file")
    now = 200L
    remote.emit("child-1", ev("turn/start", 5, """{"turn":2}"""))
    val cleared = await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated").last
    payloadOpt(cleared, "preview") shouldBe Some("")
    payloadString(cleared, "preview") should not include "read_file"

  test("one-shot turn/end still emits Finished and keeps preview"):
    var now = 0L
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "one-shot", "explore"))
    val loop = DshLoop(remote, _ => Cwd, nowMs = () => now)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit("child-1", ev("tool/call", 2, """{"callId":"c1","name":"read","arguments":"{\"path\":\"src/A.scala\"}"}"""))
    now = 100L
    remote.emit("child-1", ev("turn/end", 3, """{"turn":1,"reason":{"kind":"completed"}}"""))
    val rows = await(loop.events(Sid, 0))
    payloadTypes(rows) should contain("SubagentFinished")
    val lastUpdated = rows.filter(r => payloadType(r) == "SubagentUpdated").last
    payloadOpt(lastUpdated, "preview").get should include("read_file")

  test("two children keep isolated preview tails"):
    var now = 0L
    val remote = FakeClient()
    remote.list = catalog(
      childEntry("child-1", "running", "one-shot"),
      childEntry("child-2", "running", "one-shot")
    )
    val loop = DshLoop(remote, _ => Cwd, nowMs = () => now)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit("child-1", ev("tool/call", 2, """{"callId":"a","name":"read","arguments":"{\"path\":\"A.scala\"}"}"""))
    remote.emit("child-2", ev("tool/call", 3, """{"callId":"b","name":"bash","arguments":"{\"command\":\"ls\"}"}"""))
    val updated = await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated")
    val p1 = payloadOpt(updated.filter(r => payloadString(r, "childSessionId") == "child-1").last, "preview").get
    val p2 = payloadOpt(updated.filter(r => payloadString(r, "childSessionId") == "child-2").last, "preview").get
    p1 should include("A.scala")
    p1 should not include "ls"
    p2 should include("ls")
    p2 should not include "A.scala"

  test("child question reply uses child sessionId and echoed rpcId"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emitQuestion(
      "child-1",
      "rpc-q",
      Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson, "options" -> Json.arr(Json.obj("label" -> "Yes".asJson))))
    )
    payloadString(await(loop.events(Sid, 0)).find(r => payloadType(r) == "QuestionBatchRequested").get, "rpcId") shouldBe
      "rpc-q"
    parse(await(loop.events(Sid, 0)).find(r => payloadType(r) == "QuestionBatchRequested").get.envelopeJson).toOption.get
      .hcursor.downField("payload").get[String]("type").toOption.get shouldBe "QuestionBatchRequested"
    await(
      loop.answer(
        AgentAttachProtocol.Command.AnswerQuestionBatch(
          Sid,
          "rpc-q",
          List(AgentAttachProtocol.Command.QuestionBatchAnswer("q1", List("Yes")))
        )
      )
    ).status shouldBe "accepted"
    remote.replies.map(_._1) shouldBe Vector("rpc-q")
    remote.replies.head._2.hcursor.get[String]("sessionId").toOption.get shouldBe "child-1"

  test("child approval reply uses child sessionId"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "one-shot"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emitAsked("child-1", "rpc-a", "ap-1", "bash")
    await(loop.decide(AgentAttachProtocol.Command.DecideApproval(Sid, "r", "ap-1", approved = true)))
    remote.replies.head._2.hcursor.get[String]("sessionId").toOption.get shouldBe "child-1"

  test("child question cancel uses replyCancel only"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emitQuestion(
      "child-1",
      "rpc-q",
      Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson, "options" -> Json.arr(Json.obj("label" -> "Yes".asJson))))
    )
    await(
      loop.answer(AgentAttachProtocol.Command.AnswerQuestionBatch(Sid, "rpc-q", Nil, cancelled = true))
    ).status shouldBe "accepted"
    remote.cancels shouldBe Vector("rpc-q")
    remote.replies shouldBe empty

  test("answer RouteResult targetId is empty when parent run is over"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/end", 1, """{"turn":1,"reason":{"kind":"completed"}}"""))
    remote.emit("child-1", ev("turn/start", 2, """{"turn":1}"""))
    remote.emitQuestion(
      "child-1",
      "rpc-q",
      Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson, "options" -> Json.arr(Json.obj("label" -> "Yes".asJson))))
    )
    val result = await(
      loop.answer(
        AgentAttachProtocol.Command.AnswerQuestionBatch(
          Sid,
          "rpc-q",
          List(AgentAttachProtocol.Command.QuestionBatchAnswer("q1", List("Yes")))
        )
      )
    )
    result shouldBe RouteResult("accepted", "", "")

  test("pending question is one clump"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emitQuestion(
      "child-1",
      "rpc-q",
      Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson, "options" -> Json.arr(Json.obj("label" -> "Yes".asJson))))
    )
    await(
      loop.answer(
        AgentAttachProtocol.Command.AnswerQuestionBatch(
          Sid,
          "rpc-q",
          List(AgentAttachProtocol.Command.QuestionBatchAnswer("q1", List("Yes")))
        )
      )
    ).status shouldBe "accepted"
    val again = await(
      loop.answer(
        AgentAttachProtocol.Command.AnswerQuestionBatch(
          Sid,
          "rpc-q",
          List(AgentAttachProtocol.Command.QuestionBatchAnswer("q1", List("Yes")))
        )
      )
    )
    again.status shouldBe "rejected"
    again.detail shouldBe "no pending question"

  test("running child does not set busy; child question does"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "inactive", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/end", 1, """{"turn":1,"reason":{"kind":"completed"}}"""))
    remote.emit("child-1", ev("turn/start", 2, """{"turn":1}"""))
    loop.busy(Sid) shouldBe false
    remote.emitQuestion(
      "child-1",
      "rpc-q",
      Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson, "options" -> Json.arr(Json.obj("label" -> "Yes".asJson))))
    )
    loop.busy(Sid) shouldBe true

  test("onChildOpen fires when child opens and parent is idle"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "inactive", "continuable", "bg"))
    var opened = Vector.empty[String]
    val loop = DshLoop(remote, _ => Cwd, onChildOpen = sid => opened = opened :+ sid)
    await(loop.submit(submit("c1", "hi")))
    remote.emit("child-1", ev("turn/start", 1, """{"turn":1}"""))
    opened shouldBe empty
    remote.emit(Sid, ev("turn/end", 2, """{"turn":1,"reason":{"kind":"completed"}}"""))
    remote.emit("child-1", ev("turn/start", 3, """{"turn":1}"""))
    opened shouldBe Vector(Sid)

  test("late sourceSeq c after d is kept; Fast seq is c then d"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, ev("user/message", 2, """{"turn":1}"""))
    remote.emit(Sid, chunk(4, "d"))
    remote.emit(Sid, chunk(3, "c"))
    val deltas = await(loop.events(Sid, 0)).filter(r => payloadType(r) == "AssistantDelta")
    deltas.map(r => payloadString(r, "text")) shouldBe List("c", "d")
    deltas.map(_.seq) shouldBe List(2L, 3L)

  test("）\\n\\n delta survives as its own EventRow"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, chunkJson(2, "）\n\n"))
    val texts = await(loop.events(Sid, 0)).collect:
      case r if payloadType(r) == "AssistantDelta" => payloadString(r, "text")
    texts shouldBe List("）\n\n")

  test("idle frames consume sourceSeq so live 13 is not buffered"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/end", 2, """{"turn":1,"reason":{"kind":"completed"}}"""))
    remote.emit(Sid, chunk(11, "idle-a"))
    remote.emit(Sid, chunk(12, "idle-b"))
    await(loop.submit(submit("c2", "next")))
    remote.emit(Sid, chunk(13, "live"))
    val texts = await(loop.events(Sid, 0)).collect:
      case r if payloadType(r) == "AssistantDelta" => payloadString(r, "text")
    texts should contain("live")
    texts should contain noneOf ("idle-a", "idle-b")

  test("history fill and live share sourceSeq dedup"):
    val remote = FakeClient()
    remote.history = historyOf("text-turn.jsonl")
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, chunk(3, "Hel"))
    remote.emitSubscribed(Sid, 8)
    val texts = await(loop.events(Sid, 0)).collect:
      case r if payloadType(r) == "AssistantDelta" => payloadString(r, "text")
    texts shouldBe List("Hel", "lo")

  test("batched afterSeq replay equals a full read"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, chunk(2, "a"))
    remote.emit(Sid, chunk(3, "b"))
    val all = await(loop.events(Sid, 0)).filter(_.seq > 0)
    val mid = all(1).seq
    val joined =
      await(loop.events(Sid, 0)).filter(_.seq > 0).takeWhile(_.seq <= mid) ++
        await(loop.events(Sid, mid)).filter(_.seq > 0)
    joined.map(_.seq) shouldBe all.map(_.seq)
    joined.map(_.envelopeJson) shouldBe all.map(_.envelopeJson)

  test("last delta Fast seq is less than RunCompleted"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, chunk(2, "tail"))
    remote.emit(Sid, ev("turn/end", 3, """{"turn":1,"reason":{"kind":"completed"}}"""))
    val rows = await(loop.events(Sid, 0))
    val deltaSeq = rows.find(r => payloadType(r) == "AssistantDelta").get.seq
    val doneSeq = rows.find(r => payloadType(r) == "RunCompleted").get.seq
    deltaSeq should be < doneSeq

  test("checkpoint seals a missing delta; late chunk is ignored"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, chunk(2, "ab"))
    remote.emit(
      Sid,
      ev(
        "assistant/message",
        4,
        """{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"abcd"}]}}"""
      )
    )
    remote.emit(Sid, chunk(3, "c"))
    val rows = await(loop.events(Sid, 0))
    payloadTypes(rows).filter(t => t == "AssistantDelta" || t == "CheckpointEvent") shouldBe
      List("AssistantDelta", "CheckpointEvent")
    payloadString(rows.find(r => payloadType(r) == "CheckpointEvent").get, "content") shouldBe "abcd"
    rows.collect { case r if payloadType(r) == "AssistantDelta" => payloadString(r, "text") } shouldBe List("ab")

  test("step1 checkpoint does not drop step2 delta"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, chunk(2, "one"))
    remote.emit(
      Sid,
      ev(
        "assistant/message",
        3,
        """{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"one"}]}}"""
      )
    )
    remote.emit(
      Sid,
      ev("assistant/chunk", 4, """{"turn":1,"step":2,"chunk":{"type":"text-delta","index":0,"text":"two"}}""")
    )
    val texts = await(loop.events(Sid, 0)).collect:
      case r if payloadType(r) == "AssistantDelta" => payloadString(r, "text")
    texts shouldBe List("one", "two")

  test("parent chunks interleave with child cards; seq is monotonic; no child body"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "one-shot", "explore"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, chunk(2, "Hel"))
    remote.emit("child-1", ev("turn/start", 10, """{"turn":1}"""))
    remote.emit("child-1", ev("turn/end", 11, """{"turn":1,"reason":{"kind":"completed"}}"""))
    remote.emit("child-1", chunk(12, "nope"))
    remote.emit(Sid, chunk(3, "lo"))
    val rows = await(loop.events(Sid, 0))
    val types = payloadTypes(rows)
    types should contain("AssistantDelta")
    types should contain("SubagentUpdated")
    types should contain("SubagentFinished")
    rows.map(_.seq) shouldBe rows.map(_.seq).sorted
    rows.map(_.seq).distinct shouldBe rows.map(_.seq)
    rows.collect { case r if payloadType(r) == "AssistantDelta" => payloadString(r, "text") } shouldBe
      List("Hel", "lo")

  test("two children alternate cards; per-child order and parent seq stay monotonic"):
    val remote = FakeClient()
    remote.list = catalog(
      childEntry("child-1", "running", "one-shot", "a"),
      childEntry("child-2", "running", "one-shot", "b")
    )
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit("child-1", ev("turn/start", 1, """{"turn":1}"""))
    remote.emit("child-2", ev("turn/start", 1, """{"turn":1}"""))
    remote.emit("child-1", ev("turn/end", 2, """{"turn":1,"reason":{"kind":"completed"}}"""))
    remote.emit("child-2", ev("turn/end", 2, """{"turn":1,"reason":{"kind":"completed"}}"""))
    val rows = await(loop.events(Sid, 0))
    rows.map(_.seq) shouldBe rows.map(_.seq).sorted
    val cards = rows.filter(r => payloadType(r) == "SubagentUpdated" || payloadType(r) == "SubagentFinished")
    def childOf(r: EventRow) = payloadString(r, "childSessionId")
    def childCards(id: String) = cards.filter(r => childOf(r) == id)
    childCards("child-1").map(payloadType).last shouldBe "SubagentFinished"
    childCards("child-2").map(payloadType).last shouldBe "SubagentFinished"
    childCards("child-1").filter(r => payloadType(r) == "SubagentUpdated").map(r => payloadString(r, "activity")) should
      contain inOrder ("running", "inactive")
    childCards("child-2").filter(r => payloadType(r) == "SubagentUpdated").map(r => payloadString(r, "activity")) should
      contain inOrder ("running", "inactive")

  test("live child card takes Fast seq while parent c/d is still pending"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "one-shot", "explore"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, ev("user/message", 2, """{"turn":1}"""))
    remote.emit(Sid, chunk(4, "d"))
    remote.emit("child-1", ev("turn/start", 20, """{"turn":1}"""))
    val mid = await(loop.events(Sid, 0))
    payloadTypes(mid) should contain("SubagentUpdated")
    mid.filter(r => payloadType(r) == "AssistantDelta") shouldBe empty
    val cardSeq = mid.filter(r => payloadType(r) == "SubagentUpdated").last.seq
    remote.emit(Sid, chunk(3, "c"))
    val deltas = await(loop.events(Sid, 0)).filter(r => payloadType(r) == "AssistantDelta")
    deltas.map(r => payloadString(r, "text")) shouldBe List("c", "d")
    deltas.map(_.seq) shouldBe List(cardSeq + 1, cardSeq + 2)

  test("events hole sentinel still fires after parent deltas mix with child cards"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "one-shot", "explore"))
    val loop = DshLoop(remote, _ => Cwd, bufferCap = 3)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    (2 to 6).foreach(i => remote.emit(Sid, chunk(i, s"t$i")))
    remote.emit("child-1", ev("turn/start", 10, """{"turn":1}"""))
    remote.emit("child-1", ev("turn/end", 11, """{"turn":1,"reason":{"kind":"completed"}}"""))
    val kept = await(loop.events(Sid, 0)).filter(_.seq > 0)
    kept should have size 3
    val floor = kept.head.seq
    val hole = await(loop.events(Sid, 1))
    val gap = hole.find(r => payloadType(r) == "gap").get
    parse(gap.envelopeJson).toOption.get.hcursor.downField("payload").get[Long]("floor").toOption.get shouldBe floor
    parse(gap.envelopeJson).toOption.get.hcursor.downField("payload").get[Long]("high").toOption.get shouldBe kept.last.seq

  test("usage chunk then turn/end keeps RunStateChanged with tokensUsed before terminal"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, usageChunk(2))
    remote.emit(Sid, ev("turn/end", 3, """{"turn":1,"reason":{"kind":"completed"}}"""))
    val rows = await(loop.events(Sid, 0))
    payloadTypes(rows) shouldBe List("TurnStarted", "RunStateChanged", "RunCompleted")
    val changed = rows.find(r => payloadType(r) == "RunStateChanged").get
    payloadLong(changed, "tokensUsed") shouldBe Some(19L)
    payloadLong(changed, "turn") shouldBe Some(1L)
    changed.seq should be < rows.find(r => payloadType(r) == "RunCompleted").get.seq

  test("turn/end without usage has no RunStateChanged and terminal seq is last delta plus one"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, chunk(2, "tail"))
    remote.emit(Sid, ev("turn/end", 3, """{"turn":1,"reason":{"kind":"completed"}}"""))
    val rows = await(loop.events(Sid, 0))
    payloadTypes(rows) should not contain "RunStateChanged"
    val delta = rows.find(r => payloadType(r) == "AssistantDelta").get
    val done = rows.find(r => payloadType(r) == "RunCompleted").get
    done.seq shouldBe delta.seq + 1

  test("last parent delta Fast seq is less than SubagentFinished"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "one-shot", "explore"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(Sid, chunk(2, "tail"))
    remote.emit("child-1", ev("turn/end", 3, """{"turn":1,"reason":{"kind":"completed"}}"""))
    val rows = await(loop.events(Sid, 0))
    val deltaSeq = rows.filter(r => payloadType(r) == "AssistantDelta").last.seq
    val finishedSeq = rows.find(r => payloadType(r) == "SubagentFinished").get.seq
    deltaSeq should be < finishedSeq

  private def chunkJson(seq: Long, text: String): Json =
    Json.obj(
      "type" -> "assistant/chunk".asJson,
      "seq" -> seq.asJson,
      "time" -> seq.asJson,
      "data" -> Json.obj(
        "turn" -> 1.asJson,
        "step" -> 1.asJson,
        "chunk" -> Json.obj("type" -> "text-delta".asJson, "index" -> 0.asJson, "text" -> text.asJson)
      )
    )

  private def catalog(entries: Json*): Json =
    Json.obj(
      "ok" -> Json.True,
      "value" -> Json.obj("entries" -> Json.fromValues(entries.toList), "parentAvailable" -> Json.True)
    )

  private def childEntry(id: String, activity: String, mode: String, label: String = ""): Json =
    val base = Json.obj(
      "kind" -> "child".asJson,
      "id" -> id.asJson,
      "activity" -> activity.asJson,
      "mode" -> mode.asJson
    )
    if label.isEmpty then base else base.deepMerge(Json.obj("label" -> label.asJson))

  private def submit(clientId: String, text: String) =
    AgentAttachProtocol.Command.SubmitUserMessage(Sid, clientId, text)

  private def await[A](f: Future[A]): A = Await.result(f, 2.seconds)

  private def methods(remote: FakeClient): List[String] = remote.calls.map(_._1).toList

  private def modeOf(payload: Json): String =
    payload.hcursor.get[String]("mode").toOption.getOrElse("")

  private def createCwd(payload: Json): String =
    payload.hcursor.get[String]("cwd").toOption.getOrElse("")

  private def createSessionId(payload: Json): String =
    payload.hcursor.get[String]("sessionId").toOption.getOrElse("")

  private def createWorkspaceId(payload: Json): String =
    payload.hcursor.get[String]("workspaceId").toOption.getOrElse("")

  private def payloadType(row: EventRow): String =
    parse(row.envelopeJson).toOption.flatMap(_.hcursor.downField("payload").get[String]("type").toOption).getOrElse("")

  private def payloadTypes(rows: List[EventRow]): List[String] =
    rows.filter(_.seq > 0).map(payloadType)

  private def liveTypes(rows: List[EventRow]): Set[String] =
    rows.filter(_.seq == 0).map(payloadType).toSet

  private def payloadString(row: EventRow, field: String): String =
    parse(row.envelopeJson).toOption.flatMap(_.hcursor.downField("payload").get[String](field).toOption).getOrElse("")

  private def payloadOpt(row: EventRow, field: String): Option[String] =
    parse(row.envelopeJson).toOption.flatMap(_.hcursor.downField("payload").get[String](field).toOption)

  private def ev(tpe: String, seq: Long, data: String, time: Long = -1L): Json =
    val at = if time < 0 then seq else time
    parse(s"""{"type":"$tpe","seq":$seq,"time":$at,"data":$data}""").fold(e => fail(e.message), identity)

  private def userSource(seq: Long, kind: String, sender: String, time: Long = -1L): Json =
    ev(
      "user/message",
      seq,
      s"""{"source":{"kind":"$kind","form":"notice","senderSessionId":"$sender"}}""",
      time
    )

  private def chunk(seq: Long, text: String): Json =
    ev("assistant/chunk", seq, s"""{"turn":1,"step":1,"chunk":{"type":"text-delta","index":0,"text":"$text"}}""")

  private def usageChunk(seq: Long): Json =
    ev(
      "assistant/chunk",
      seq,
      """{"turn":1,"step":1,"chunk":{"type":"usage","usage":{"inputTokens":10,"outputTokens":4,"cacheReadTokens":3,"cacheWriteTokens":2}}}"""
    )

  private def payloadLong(row: EventRow, field: String): Option[Long] =
    parse(row.envelopeJson).toOption.flatMap(_.hcursor.downField("payload").get[Long](field).toOption)

  private def historyOf(name: String): Json =
    val src = Source.fromResource(s"dsh/$name")
    val events =
      try
        src.getLines().map(_.trim).filter(_.nonEmpty).map: line =>
          parse(line).fold(e => fail(s"$name: $e"), identity)
        .toList
      finally src.close()
    Json.obj(
      "ok" -> Json.True,
      "value" -> Json.obj(
        "events" -> Json.fromValues(events.map(e => Json.obj("event" -> e))),
        "hasMore" -> Json.False
      )
    )

private class FakeClient extends Client:
  var emitFn: Json => Unit = _ => ()
  var emitHostFn: Json => Unit = _ => ()
  var calls: Vector[(String, Json)] = Vector.empty
  var replies: Vector[(String, Json)] = Vector.empty
  var cancels: Vector[String] = Vector.empty
  var replyFail: Option[String] = None
  var create: Json =
    Json.obj("ok" -> Json.True, "value" -> Json.obj("sessionId" -> "sess-1".asJson))
  var prompt: Json =
    Json.obj("ok" -> Json.True, "value" -> Json.obj("accepted" -> Json.True))
  var cancel: Json =
    Json.obj("ok" -> Json.True, "value" -> Json.obj("accepted" -> Json.True))
  var history: Json =
    Json.obj("ok" -> Json.True, "value" -> Json.obj("events" -> Json.arr(), "hasMore" -> Json.False))
  var list: Json =
    Json.obj("ok" -> Json.True, "value" -> Json.obj("entries" -> Json.arr(), "parentAvailable" -> Json.True))
  var listHold: Option[Promise[Json]] = None

  def call(method: String, payload: Json): Future[Json] =
    calls = calls :+ (method -> payload)
    method match
      case "session.create"  => Future.successful(create)
      case "session.prompt"  => Future.successful(prompt)
      case "session.cancel"  => Future.successful(cancel)
      case "session.history" => Future.successful(history)
      case "subagent.list"   => listHold.map(_.future).getOrElse(Future.successful(list))
      case _                 => Future.successful(Json.obj("ok" -> Json.True, "value" -> Json.obj()))

  def reply(rpcId: String, value: Json): Future[Unit] =
    replies = replies :+ (rpcId -> value)
    replyFail.fold(Future.unit)(m => Future.failed(RuntimeException(m)))
  override def replyCancel(rpcId: String): Future[Unit] =
    cancels = cancels :+ rpcId
    replyFail.fold(Future.unit)(m => Future.failed(RuntimeException(m)))
  def listen(channel: String)(emit: Json => Unit): Unit =
    channel match
      case "mux"  => emitFn = emit
      case "host" => emitHostFn = emit
      case _      => ()
  def ready: Future[Unit] = Future.unit
  def close(): Unit = ()
  def emitMux(frame: Json): Unit = emitFn(frame)
  def emitHost(frame: Json): Unit = emitHostFn(frame)
  def emit(sessionId: String, event: Json): Unit =
    emitFn(
      Json.obj(
        "type" -> Json.fromString("session/event"),
        "sessionId" -> Json.fromString(sessionId),
        "event" -> event
      )
    )
  def emitSubscribed(sessionId: String, lastSeq: Long): Unit =
    emitFn(
      Json.obj(
        "type" -> Json.fromString("session/subscribed"),
        "sessionId" -> Json.fromString(sessionId),
        "lastSeq" -> Json.fromLong(lastSeq)
      )
    )
  def emitAsked(
      sessionId: String,
      rpcId: String,
      approvalId: String,
      tool: String,
      reason: Option[String] = None,
      callId: Option[String] = None
  ): Unit =
    val payload = Json.obj(
      "type" -> Json.fromString("approval/requested"),
      "sessionId" -> Json.fromString(sessionId),
      "approvalId" -> Json.fromString(approvalId),
      "toolName" -> Json.fromString(tool)
    )
    val extra = List(
      reason.map(r => "reason" -> Json.fromString(r)),
      callId.map(c => "callId" -> Json.fromString(c))
    ).flatten
    emitFn(
      Json.obj(
        "type" -> Json.fromString("server-request"),
        "rpcId" -> Json.fromString(rpcId),
        "method" -> Json.fromString("approval/requested"),
        "payload" -> extra.foldLeft(payload) { (j, kv) => j.mapObject(_.add(kv._1, kv._2)) }
      )
    )
  def emitQuestion(sessionId: String, rpcId: String, questions: Json): Unit =
    emitFn(
      Json.obj(
        "type" -> Json.fromString("server-request"),
        "rpcId" -> Json.fromString(rpcId),
        "method" -> Json.fromString("question/requested"),
        "payload" -> Json.obj(
          "type" -> Json.fromString("question/requested"),
          "sessionId" -> Json.fromString(sessionId),
          "questions" -> questions
        )
      )
    )
  def emitQuestionDone(sessionId: String, questionRpcId: String, outcome: String): Unit =
    emitFn(
      Json.obj(
        "type" -> Json.fromString("question/resolved"),
        "sessionId" -> Json.fromString(sessionId),
        "questionRpcId" -> Json.fromString(questionRpcId),
        "outcome" -> Json.fromString(outcome)
      )
    )
  def emitDone(sessionId: String, approvalId: String, outcome: String): Unit =
    emitFn(
      Json.obj(
        "type" -> Json.fromString("approval/resolved"),
        "sessionId" -> Json.fromString(sessionId),
        "approvalId" -> Json.fromString(approvalId),
        "outcome" -> Json.fromString(outcome)
      )
    )

private class DummyLoop extends AgentLoop:
  val caps: Caps = Caps(cancel = true, approval = true, question = true, restore = true)
  def submit(cmd: AgentAttachProtocol.Command.SubmitUserMessage): Future[Admit] =
    Future.successful(Admit.Rejected("fast"))
  def cancel(cmd: AgentAttachProtocol.Command.CancelRun): Future[Admit] =
    Future.successful(Admit.Rejected("fast"))
  def decide(cmd: AgentAttachProtocol.Command.DecideApproval): Future[RouteResult] =
    Future.successful(RouteResult("rejected", "", "fast"))
  override def answer(cmd: AgentAttachProtocol.Command.AnswerQuestionBatch): Future[RouteResult] =
    Future.successful(RouteResult("rejected", "", "fast_question_batch"))
  def events(sessionId: String, afterSeq: Long): Future[List[EventRow]] = Future.successful(Nil)
  def restore(sessionId: String, beforeTurnId: Option[String], limit: Int): Future[ChannelMessageWindow] =
    Future.successful(ChannelMessageWindow(Nil, false, 0))
