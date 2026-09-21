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

/** DshLoopSpec — mux / history / seq ingest. Loaded by DshLoopSpec. */
trait DshIngestSpec:
  this: AnyFunSuite & Matchers & DshLoopKit =>

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

  test("persist-high afterSeq still yields the DSH river once — CommandLoop maxSeq is a different clock"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "你是谁")))
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(
      Sid,
      ev(
        "assistant/message",
        2,
        """{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"我是 DeepSeek Harness"}]}}"""
      )
    )
    remote.emit(Sid, ev("turn/end", 3, """{"turn":1,"reason":{"kind":"completed"}}"""))
    val first = await(loop.events(Sid, 20)).filter(_.seq > 0)
    payloadTypes(first) should contain("CheckpointEvent")
    payloadTypes(first) should contain("RunCompleted")
    // CommandLoop persistCursor and Host lastApplied share this clock. Native DSH
    // buffer seq 1..n would be dropped as "already applied" after SetEngine/attach.
    first.map(_.seq) shouldBe (21L to (20L + first.size)).toList
    payloadTypes(await(loop.events(Sid, first.last.seq))) shouldBe Nil
    payloadTypes(await(loop.events(Sid, Long.MaxValue))).filter(_ != "dsh_caps") shouldBe Nil

  test("0.1.2 page after submit: block-end + assistant/message + turn/end reach the Fast river"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.bind(Sid, Cwd))
    await(loop.submit(submit("c1", "你是谁"))) shouldBe Admit.Accepted(s"$Sid:c1")
    remote.emit(Sid, ev("turn/start", 1, """{"turn":1}"""))
    remote.emit(
      Sid,
      ev(
        "assistant/chunk",
        2,
        """{"turn":1,"step":1,"chunk":{"type":"block-end","index":1,"block":{"type":"text","text":"我是 DeepSeek Harness"}}}"""
      )
    )
    remote.emit(
      Sid,
      ev(
        "assistant/message",
        3,
        """{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"我是 DeepSeek Harness"}]}}"""
      )
    )
    remote.emit(Sid, ev("turn/end", 4, """{"turn":1,"reason":{"kind":"completed"}}"""))
    val rows = await(loop.events(Sid, 0)).filter(_.seq > 0)
    payloadTypes(rows) should contain("CheckpointEvent")
    payloadTypes(rows) should contain("RunCompleted")
    val ckpt = rows.exists(r =>
      payloadType(r) == "CheckpointEvent" && payloadString(r, "content").contains("DeepSeek Harness")
    )
    val delta = rows.exists(r =>
      payloadType(r) == "AssistantDelta" && payloadString(r, "text").contains("DeepSeek Harness")
    )
    ckpt shouldBe true
    delta shouldBe true

  test("events hole sentinel: afterSeq behind bufferFloor is not an empty idle"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd, bufferCap = 3, river = DshRiver.local(3))
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

  test("subscribed fill reads peeled session.page events (historyValue shape)"):
    val remote = FakeClient()
    val inner = ev(
      "assistant/chunk",
      3,
      """{"turn":1,"step":1,"chunk":{"type":"text-delta","index":0,"text":"peeled"}}"""
    )
    remote.history = Json.obj(
      "ok" -> Json.True,
      "value" -> Json.obj("events" -> Json.arr(inner), "hasMore" -> Json.False)
    )
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 8)
    val texts = await(loop.events(Sid, 0)).collect:
      case r if payloadType(r) == "AssistantDelta" => payloadString(r, "text")
    texts should contain("peeled")

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
    val loop = DshLoop(remote, _ => Cwd, bufferCap = 3, river = DshRiver.local(3))
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
    payloadTypes(rows) shouldBe List("TurnStarted", "UsageReported", "RunStateChanged", "RunCompleted")
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
