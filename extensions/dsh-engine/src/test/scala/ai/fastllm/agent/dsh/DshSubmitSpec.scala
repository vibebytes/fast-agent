package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.{Admit, AgentAttachProtocol, AgentLoop, Caps, ChannelMessageWindow, EventRow, RouteResult, dshQueuedOnto}
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

/** DshLoopSpec — bind / submit / caps / turn hooks. Loaded by DshLoopSpec. */
trait DshSubmitSpec:
  this: AnyFunSuite & Matchers & DshLoopKit =>

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
    remote.calls.filter(_._1 == "session.prompt").last._2.hcursor.get[String]("requestId").toOption.get shouldBe "c1"

  test("submit still rejects structured skillSlash"):
    val loop = DshLoop(FakeClient(), _ => Cwd)
    val cmd = AgentAttachProtocol.Command.SubmitUserMessage(
      Sid,
      "c1",
      "/demo",
      skillSlash = Some(AgentAttachProtocol.SkillSlashPayload("demo", "", "/demo"))
    )
    await(loop.submit(cmd)) shouldBe Admit.Rejected("dsh_slash")

  test("session/title is not an EventRow; onTitle fires"):
    val remote = FakeClient()
    var titles = Vector.empty[(String, String)]
    val loop = DshLoop(remote, _ => Cwd, onTitle = (s, t) => titles = titles :+ (s -> t))
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("session/title", 1, """{"title":"Fix the parser","messageSeqs":[],"source":{"kind":"fallback"}}"""))
    payloadTypes(await(loop.events(Sid, 0))) should not contain "session/title"
    titles shouldBe Vector(Sid -> "Fix the parser")

  test("session-conflict create is an idempotent bind, not a rejection"):
    val remote = FakeClient()
    remote.create =
      Json.obj("ok" -> Json.False, "error" -> Json.obj("code" -> "session-conflict".asJson, "message" -> "cwd".asJson))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi"))) shouldBe Admit.Accepted(s"$Sid:c1")
    methods(remote) shouldBe List("session.create", "session.prompt")

  test("a non-conflict create error still rejects; no Binding"):
    val remote = FakeClient()
    remote.create =
      Json.obj("ok" -> Json.False, "error" -> Json.obj("code" -> "cwd-missing".asJson, "message" -> "cwd".asJson))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi"))) shouldBe Admit.Rejected("cwd-missing")
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
  test("caps: answerQuestion false, the rest true"):
    DshLoop(FakeClient(), _ => Cwd).caps shouldBe Caps(
      cancel = true,
      approval = true,
      answerQuestion = false,
      restore = true,
      steer = true,
      queue = true,
      rerun = false,
      usage = true,
      childTranscript = true,
      goalDelta = true,
      contextPrune = true
    )

  test("invariant 1: dsh_caps.queue mirrors caps.queue; false rejects QueueMessage"):
    val loop = DshLoop(FakeClient(), _ => Cwd)
    await(loop.bind(Sid, Cwd)) shouldBe Right(())
    val caps = loop.caps
    val row = await(loop.events(Sid, 0)).find(r => payloadType(r) == "dsh_caps").get
    val wireQueue = parse(row.envelopeJson).toOption.get.hcursor
      .downField("payload").get[Boolean]("queue").toOption.get
    wireQueue shouldBe caps.queue
    if caps.queue then
      await(loop.queue(AgentAttachProtocol.Command.QueueMessage(Sid, "i1", "remove", None))) shouldBe
        a[Admit.Accepted]
    else
      await(loop.queue(AgentAttachProtocol.Command.QueueMessage(Sid, "i1", "remove", None))) shouldBe
        Admit.Rejected("queue disabled")

  test("bind emits dsh_caps with explicit keys"):
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
    p.get[Boolean]("rerun").toOption.get shouldBe false
    p.keys.map(_.toSet).get shouldBe Set("type", "sessionId", "queue", "goal", "budget", "question", "slash", "rerun")

  test("dsh_caps last-wins; FastLoop events have no dsh_*"):
    val loop = DshLoop(FakeClient(), _ => Cwd)
    await(loop.bind(Sid, Cwd))
    await(loop.bind(Sid, Cwd))
    await(loop.events(Sid, 0)).count(r => payloadType(r) == "dsh_caps") shouldBe 1
    await(DummyLoop().events("s", 0)).exists(r => payloadType(r).startsWith("dsh_")) shouldBe false

  test("SteerRun prompts mode=steer; QueueMessage calls session.updateQueue"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "one")))
    await(loop.steer(AgentAttachProtocol.Command.SteerRun(Sid, "nudge"))) shouldBe Admit.Steered(s"$Sid:c1")
    remote.calls.filter(_._1 == "session.prompt").map(c => modeOf(c._2)).last shouldBe "steer"
    await(loop.queue(AgentAttachProtocol.Command.QueueMessage(Sid, "m1", "remove"))).status shouldBe "accepted"
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
    await(loop.steer(AgentAttachProtocol.Command.SteerRun(Sid, "see", List(png)))).status shouldBe "steered"
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
    EngineIds.switch("fast", loop.busy(Sid), avail) shouldBe
      EngineSwitch.Apply(Some("fast"))
    await(loop.submit(submit("c1", "hi")))
    loop.liveRun(Sid) shouldBe Some(s"$Sid:c1")
    EngineIds.switch("fast", loop.busy(Sid), avail) shouldBe
      EngineSwitch.Rejected("busy")
    EngineIds.switch("dsh", loop.busy(Sid), avail) shouldBe
      EngineSwitch.Rejected("busy")
    remote.emit(Sid, ev("turn/end", 1, """{"turn":1,"reason":{"kind":"completed"}}"""))
    loop.liveRun(Sid) shouldBe None
    EngineIds.switch("fast", loop.busy(Sid), avail) shouldBe
      EngineSwitch.Apply(Some("fast"))
