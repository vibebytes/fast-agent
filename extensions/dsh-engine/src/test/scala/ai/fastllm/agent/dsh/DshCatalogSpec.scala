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

/** DshLoopSpec — child catalog / lifecycle. Loaded by DshLoopSpec. */
trait DshCatalogSpec:
  this: AnyFunSuite & Matchers & DshLoopKit =>

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

  test("catalog idle repeat with quiet mux settles a turn-open child"):
    var now = 0L
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd, nowMs = () => now)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit("child-1", ev("turn/start", 1, """{"turn":1}"""))
    remote.list = catalog(childEntry("child-1", "inactive", "continuable", "bg"))
    loop.sweepOpenChildren()
    payloadString(await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated").last, "activity") shouldBe
      "running"
    loop.childOpen(Sid) shouldBe true
    loop.sweepOpenChildren()
    payloadString(await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated").last, "activity") shouldBe
      "inactive"
    loop.childOpen(Sid) shouldBe false

  test("child mux traffic between idle reads defers catalog settle"):
    var now = 0L
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd, nowMs = () => now)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emit("child-1", ev("turn/start", 1, """{"turn":1}"""))
    remote.list = catalog(childEntry("child-1", "inactive", "continuable", "bg"))
    loop.sweepOpenChildren()
    now = 50L
    remote.emit("child-1", chunk(2, "busy"))
    now = 100L
    loop.sweepOpenChildren()
    payloadString(await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated").last, "activity") shouldBe
      "running"
    loop.childOpen(Sid) shouldBe true
    now = 200L
    loop.sweepOpenChildren()
    payloadString(await(loop.events(Sid, 0)).filter(r => payloadType(r) == "SubagentUpdated").last, "activity") shouldBe
      "inactive"
    loop.childOpen(Sid) shouldBe false

  test("sweep keeps listing after subagent tool/call until the spawn window closes"):
    var now = 0L
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd, nowMs = () => now)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("tool/call", 2, """{"name":"subagent"}"""))
    val base = methods(remote).count(_ == "subagent.list")
    loop.sweepOpenChildren()
    methods(remote).count(_ == "subagent.list") shouldBe base + 1
    now = 70000L
    loop.sweepOpenChildren()
    methods(remote).count(_ == "subagent.list") shouldBe base + 1

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

  test("subagent/descriptor on the parent stream triggers a list so the child gets watched"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    methods(remote).count(_ == "subagent.list") shouldBe 0
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    remote.emit(Sid, ev("subagent/descriptor", 2, """{"sessionId":"child-1","mode":"continuable"}"""))
    methods(remote).count(_ == "subagent.list") shouldBe 1
    payloadTypes(await(loop.events(Sid, 0))) should contain("SubagentStarted")

  test("subagent event without a child id does not list"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("subagent/descriptor", 2, """{"mode":"continuable"}"""))
    methods(remote).count(_ == "subagent.list") shouldBe 0

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
