package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.AgentAttachProtocol.Event.*
import ai.fastllm.agent.message.{PlanPayload, PlanTodo, PlanTodoStatus}
import io.circe.Json
import io.circe.parser.parse
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import scala.io.Source

class DshEventsSpec extends AnyFunSuite with Matchers:

  private val Sid = "sess-1"
  private val Rid = "run-1"

  test("text turn: start + deltas; user/message stays out; assistant/message is checkpoint"):
    typesOf("text-turn.jsonl") shouldBe List(
      "RunCreated",
      "TurnStarted",
      "AssistantDelta",
      "AssistantDelta",
      "ReasoningDelta",
      "CheckpointEvent",
      "RunStateChanged"
    )
    val step = fold("text-turn.jsonl")
    step.events.collect { case RunCreated(_, agentId, runId, parent, _, _) => (agentId, runId, parent) } shouldBe
      List(("dsh", Rid, None))
    step.events.collect { case TurnStarted(_, _, turnId, _, _) => turnId } shouldBe List("1")
    step.events.collect { case AssistantDelta(_, _, text, _) => text } shouldBe List("Hel", "lo")
    step.events.collect { case ReasoningDelta(_, _, text, _) => text } shouldBe List("think")
    step.events.collect { case r: RunStateChanged => r.status } shouldBe List("completed")
    step.tokensUsed shouldBe None

  test("tool pair: arguments land in args.raw; flatten command; result success"):
    val step = fold("tool-pair.jsonl")
    typesOf("tool-pair.jsonl") shouldBe List("RunCreated", "TurnStarted", "ToolStarted", "ToolFinished", "RunStateChanged")
    val started = step.events.collect { case t: ToolStarted => t }.head
    started.toolCallId shouldBe "call-1"
    started.name shouldBe "shell"
    started.args("raw") shouldBe """{"command":"ls"}"""
    started.args("command") shouldBe "ls"
    val finished = step.events.collect { case t: ToolFinished => t }.head
    finished.toolCallId shouldBe "call-1"
    finished.status shouldBe "success"
    finished.output shouldBe "a.txt"

  test("tool/result with error → status failed; flatten failure still emits ToolStarted"):
    val call = parse("""{"type":"tool/call","data":{"callId":"c2","name":"read","arguments":"not-json"}}""").toOption.get
    val result = parse(
      """{"type":"tool/result","data":{"message":{"content":[{"type":"tool-result","toolCallId":"c2","content":[{"type":"text","text":"nope"}],"isError":true}]},"error":{"name":"E","code":"X"}}}"""
    ).toOption.get
    val step = dshEvents(Sid, Rid, List(call, result))
    val started = step.events.collect { case t: ToolStarted => t }.head
    started.name shouldBe "read_file"
    started.args shouldBe Map("raw" -> "not-json")
    val finished = step.events.collect { case t: ToolFinished => t }.head
    finished.status shouldBe "failed"
    finished.output shouldBe "nope"

  test("dshTool maps Host names onto Fast cards; unknown stays"):
    dshTool("bash") shouldBe "shell"
    dshTool("read") shouldBe "read_file"
    dshTool("edit") shouldBe "edit_file"
    dshTool("write") shouldBe "write_file"
    dshTool("glob") shouldBe "glob"

  test("dshRisk folds reason; dshContext never uses callId"):
    dshRisk("write", Some("escalate sandbox to danger-full-access: outside the session workspace")) shouldBe
      "external_directory"
    dshRisk("write", Some("write a file")) shouldBe "workspace_write"
    dshRisk("bash", Some("sandbox")) shouldBe "shell"
    dshContext(Map("file_path" -> "/tmp/a.txt", "raw" -> "{}")) shouldBe Some("/tmp/a.txt")
    dshContext(Map("command" -> "ls", "raw" -> "{}")) shouldBe Some("ls")
    dshContext(Map("raw" -> "{}")) shouldBe None

  test("llm/retry* → LlmNetworkWait(retrying)"):
    val step = fold("retry.jsonl")
    typesOf("retry.jsonl") shouldBe List("LlmNetworkWait", "LlmNetworkWait")
    val waits = step.events.collect { case w: LlmNetworkWait => w }
    waits.map(_.phase) shouldBe List("retrying", "retrying")
    waits.head.attempt shouldBe Some(1)
    waits.head.maxAttempts shouldBe Some(3)
    waits.head.reason shouldBe Some("busy")

  test("todo/write → MessagePatched Plan; next turn/start clears; title and goal stay out of the river"):
    typesOf("todo-compaction-title.jsonl") shouldBe List(
      "MessagePatched",
      "MessagePatched",
      "RunCreated",
      "TurnStarted",
      "TaskUpdated",
      "TaskUpdated",
      "TaskUpdated"
    )
    val step = fold("todo-compaction-title.jsonl")
    val patches = step.events.collect { case p: MessagePatched => p }
    patches.map(_.action) shouldBe List("create", "replace")
    patches.map(_.planId).distinct shouldBe List(s"dsh-todo:$Sid")
    val created = PlanPayload.parse(patches.head.payloadJson).toOption.get
    created.todos shouldBe List(
      PlanTodo("cf35524f4d42", "read the file", PlanTodoStatus.InProgress),
      PlanTodo("4380284ab577", "write tests", PlanTodoStatus.Pending)
    )
    PlanPayload.parse(patches(1).payloadJson).toOption.get.todos shouldBe Nil
    val tasks = step.events.collect { case t: TaskUpdated => t }
    tasks.map(t => (t.taskId, t.kind, t.status, t.title, t.detail)) shouldBe List(
      ("cmp-1", "compaction", "running", "Compacting context", None),
      ("cmp-1", "compaction", "running", "Compacting context", Some("kept the last turn")),
      ("cmp-1", "compaction", "done", "Compacting context", None)
    )
    step.title shouldBe Some("Fix the parser")
    step.fold.hasTodoPlan shouldBe false

  test("usage: chunk replaces message fallback; steps sum; reasoning not double-counted; abort has no usage"):
    val step = fold("usage.jsonl")
    val afterTurn1 = dshEvents(Sid, Rid, load("usage.jsonl").take(5))
    afterTurn1.tokensUsed shouldBe Some(25L)
    afterTurn1.events.collect { case r: RunStateChanged => (r.status, r.turn, r.tokensUsed) } shouldBe
      List(("completed", Some(1), Some(25L)))
    step.tokensUsed shouldBe None
    step.events.collect { case r: RunStateChanged => (r.status, r.tokensUsed) } shouldBe
      List(("completed", Some(25L)), ("cancelled", None))

  test("mux payload.event unwraps to the same SessionEvent"):
    val inner = parse("""{"type":"assistant/chunk","seq":1,"time":1,"data":{"turn":1,"step":1,"chunk":{"type":"text-delta","index":0,"text":"x"}}}""").toOption.get
    val mux = Json.obj("payload" -> Json.obj("event" -> inner))
    dshEvents(Sid, Rid, mux, DshFold()).events shouldBe List(AssistantDelta(Sid, Rid, "x", Some("1:1")))

  test("dshRows wrap payloadJson so SessionEventStream can read type"):
    val rows = dshRows(Sid, Rid, load("text-turn.jsonl"))
    rows.map(_.seq) shouldBe List(1L, 2L, 3L, 4L, 5L, 6L, 7L)
    val types = rows.map: r =>
      parse(r.envelopeJson).toOption.get.hcursor.downField("payload").get[String]("type").toOption.get
    types shouldBe List(
      "RunCreated",
      "TurnStarted",
      "AssistantDelta",
      "AssistantDelta",
      "ReasoningDelta",
      "CheckpointEvent",
      "RunStateChanged"
    )

  test("subagent/descriptor has no child runId → not in the river"):
    val ev = parse("""{"type":"subagent/descriptor","data":{"version":2,"mode":"one-shot","provider":"task","label":"explore"}}""").toOption.get
    dshEvents(Sid, Rid, ev, DshFold()).events shouldBe Nil

  test("dshEndStatus table"):
    dshEndStatus("aborted") shouldBe "cancelled"
    dshEndStatus("cancelled") shouldBe "cancelled"
    dshEndStatus("error") shouldBe "failed"
    dshEndStatus("interrupted") shouldBe "failed"
    dshEndStatus("max-tokens") shouldBe "completed"
    dshEndStatus("blocked") shouldBe "completed"
    dshEndStatus("completed") shouldBe "completed"
    dshEndStatus("mystery") shouldBe "completed"

  test("parent turn/end interrupted settles as a RunFailed terminal"):
    val ev = parse("""{"type":"turn/end","data":{"turn":1,"reason":{"kind":"interrupted"}}}""").toOption.get
    dshEvents(Sid, Rid, ev, DshFold()).events shouldBe List(RunFailed(Sid, Rid, "dsh turn failed"))

  test("parent turn/end error carries the failure message on RunFailed"):
    val ev = parse(
      """{"type":"turn/end","data":{"turn":1,"reason":{"kind":"error","message":"Declined: 402 Payment Required"}}}"""
    ).toOption.get
    dshEvents(Sid, Rid, ev, DshFold()).events shouldBe List(RunFailed(Sid, Rid, "Declined: 402 Payment Required"))

  test("parent turn/end completed still emits RunStateChanged with usage"):
    val ev = parse("""{"type":"turn/end","data":{"turn":1,"reason":{"kind":"completed"}}}""").toOption.get
    dshEvents(Sid, Rid, ev, DshFold()).events.collect { case r: RunStateChanged => r.status } shouldBe
      List("completed")

  test("assistant/message becomes checkpoint with unitId and full text"):
    val ev = parse(
      """{"type":"assistant/message","data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"Hello"}]},"usage":{"inputTokens":1,"outputTokens":2}}}"""
    ).toOption.get
    val step = dshEvents(Sid, Rid, ev, DshFold())
    step.events shouldBe List(CheckpointEvent(Sid, Rid, "1:1", "Hello", Some(3L)))

  test("assistant/message checkpoint keeps only text blocks — reasoning must not enter the body"):
    val think =
      "The user asks in Chinese what tools I have. I should answer directly based on my available tools: bash shell and str_replace_editor (view/create/edit/insert), plus the ability to use multiple tool calls. Keep it concise"
    val answer = "我目前主要有两类工具："
    val ev = parse(
      s"""{"type":"assistant/message","data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"reasoning","text":${io.circe.Json.fromString(think).noSpaces}},{"type":"text","text":${io.circe.Json.fromString(answer).noSpaces}}]}}}"""
    ).toOption.get
    val step = dshEvents(Sid, Rid, ev, DshFold())
    val content = step.events.collect { case CheckpointEvent(_, _, _, text, _) => text }
    content shouldBe List(answer)
    content.headOption.exists(_.contains("The user asks")) shouldBe false

  test("compaction/end with error → failed; missing compactionId uses session fallback"):
    val start = parse("""{"type":"compaction/start","data":{"turn":null}}""").toOption.get
    val end = parse("""{"type":"compaction/end","data":{"error":"provider failed","turn":null}}""").toOption.get
    val step = dshEvents(Sid, Rid, List(start, end))
    val tasks = step.events.collect { case t: TaskUpdated => t }
    tasks.map(t => (t.taskId, t.status)) shouldBe List(
      (s"dsh-compaction:$Sid", "running"),
      (s"dsh-compaction:$Sid", "failed")
    )

  test("goal/change is not GoalUpdated"):
    val change = parse("""{"type":"goal/change","data":{"operation":"create","goal":{"title":"Ship"}}}""").toOption.get
    val types = dshEvents(Sid, Rid, List(change)).events.map(_.getClass.getSimpleName.stripSuffix("$"))
    types shouldBe Nil
    types should not contain "GoalUpdated"

  test("mux control and host frames are not AgentEvents"):
    val queue = parse("""{"type":"session/queue","sessionId":"s","items":[]}""").toOption.get
    val host = parse("""{"type":"host/session-added","sessionId":"s","blank":true}""").toOption.get
    dshEvents(Sid, Rid, List(queue)).events shouldBe Nil
    dshEvents(Sid, Rid, List(host)).events shouldBe Nil
    dshEvents(Sid, Rid, List(queue)).events.map(_.getClass.getSimpleName) should not contain "dsh_queue"

  private def fold(name: String): DshStep = dshEvents(Sid, Rid, load(name))

  private def typesOf(name: String): List[String] =
    fold(name).events.map(_.getClass.getSimpleName.stripSuffix("$"))

  private def load(name: String): List[Json] =
    val src = Source.fromResource(s"dsh/$name")
    try
      src.getLines().map(_.trim).filter(_.nonEmpty).map: line =>
        parse(line).fold(e => fail(s"$name: $e"), identity)
      .toList
    finally src.close()
