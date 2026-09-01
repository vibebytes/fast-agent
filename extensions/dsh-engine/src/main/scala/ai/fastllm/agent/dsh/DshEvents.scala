package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.{AgentEvent, EventRow, payloadJson}
import ai.fastllm.agent.channel.AgentAttachProtocol.Event.*
import ai.fastllm.agent.message.{PlanPayload, PlanTodo, PlanTodoStatus}
import io.circe.Json
import io.circe.syntax.*

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/** Per-step billed buckets. `reasoningTokens` is output subset — not added again. */
final case class DshUsage(
    inputTokens: Long = 0,
    outputTokens: Long = 0,
    cacheReadTokens: Long = 0,
    cacheWriteTokens: Long = 0
):
  def billed: Long = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
  def +(o: DshUsage): DshUsage =
    DshUsage(
      inputTokens + o.inputTokens,
      outputTokens + o.outputTokens,
      cacheReadTokens + o.cacheReadTokens,
      cacheWriteTokens + o.cacheWriteTokens
    )

final case class DshFold(
    hasTodoPlan: Boolean = false,
    usage: Map[(Int, Int), DshUsage] = Map.empty
)

/** One mux SessionEvent. `tokensUsed` only on `turn/end` with at least one step usage. */
final case class DshStep(
    events: List[AgentEvent],
    fold: DshFold,
    tokensUsed: Option[Long] = None,
    title: Option[String] = None
)

/** DSH SessionEvent JSON (or mux `payload.event`) → Fast river. */
def dshEvents(sessionId: String, runId: String, event: Json, fold: DshFold): DshStep =
  val raw = event.hcursor.downField("payload").downField("event").focus.getOrElse(event)
  val t = raw.hcursor.get[String]("type").toOption.getOrElse("")
  val data = raw.hcursor.downField("data").focus.getOrElse(Json.obj())
  t match
    case "turn/start" =>
      val turnId = data.hcursor.get[Int]("turn").toOption.map(_.toString).getOrElse("0")
      val clear =
        if fold.hasTodoPlan then List(patched(sessionId, runId, "replace", Nil)) else Nil
      DshStep(
        clear ++ List(
          RunCreated(sessionId, "dsh", runId),
          TurnStarted(sessionId, runId, turnId)
        ),
        fold.copy(hasTodoPlan = false)
      )
    case "assistant/chunk" =>
      chunkStep(sessionId, runId, data, fold)
    case "assistant/message" =>
      val u = usageOf(data.hcursor.downField("usage").focus.getOrElse(Json.Null))
      val next =
        (for
          k <- turnStep(data)
          usage <- u
          if !fold.usage.contains(k)
        yield fold.copy(usage = fold.usage + (k -> usage))).getOrElse(fold)
      val ev = turnStep(data).toList.map: (turn, step) =>
        CheckpointEvent(sessionId, runId, s"$turn:$step", messageText(data), u.map(_.billed))
      DshStep(ev, next)
    case "tool/call" =>
      val id = data.hcursor.get[String]("callId").toOption.getOrElse("")
      val name = dshTool(data.hcursor.get[String]("name").toOption.getOrElse(""))
      val rawArgs = data.hcursor.get[String]("arguments").toOption.getOrElse("")
      DshStep(List(ToolStarted(sessionId, runId, id, name, flatArgs(rawArgs))), fold)
    case "tool/result" =>
      DshStep(List(toolFinished(sessionId, runId, data)), fold)
    case "llm/retry" | "llm/retry-started" =>
      val attempt = data.hcursor.get[Int]("retry").toOption
      val max = data.hcursor.get[Int]("maxRetries").toOption
      val reason = data.hcursor.downField("failure").get[String]("message").toOption
      DshStep(
        List(LlmNetworkWait(sessionId, runId, "retrying", attempt = attempt, maxAttempts = max, reason = reason)),
        fold
      )
    case "turn/end" =>
      val kind = data.hcursor.downField("reason").get[String]("kind").toOption.getOrElse("completed")
      val status = dshEndStatus(kind)
      val turn = data.hcursor.get[Int]("turn").toOption
      val billed = turn.flatMap: n =>
        val steps = fold.usage.collect { case ((t, _), u) if t == n => u }.toList
        if steps.isEmpty then None else Some(steps.foldLeft(DshUsage())(_ + _).billed)
      val rest = turn.fold(fold.usage)(n => fold.usage.filter { case ((t, _), _) => t != n })
      if status == "failed" then
        // Terminal RunFailed (not RunStateChanged): BusyRoots only clear on
        // terminal events, and clients seal the error card from run_failed.
        DshStep(List(RunFailed(sessionId, runId, endFailureMessage(data))), fold.copy(usage = rest), tokensUsed = billed)
      else
        DshStep(List(RunStateChanged(sessionId, runId, status, turn, billed)), fold.copy(usage = rest), tokensUsed = billed)
    case "todo/write" =>
      val todos = planTodos(data)
      val action = if fold.hasTodoPlan then "replace" else "create"
      DshStep(List(patched(sessionId, runId, action, todos)), fold.copy(hasTodoPlan = todos.nonEmpty))
    case "compaction/start" =>
      DshStep(List(compaction(sessionId, data, "running", title = "Compacting context", detail = None)), fold)
    case "compaction/summary" =>
      val detail = summaryText(data).map(truncate(_, 240))
      DshStep(List(compaction(sessionId, data, "running", title = "Compacting context", detail = detail)), fold)
    case "compaction/end" =>
      val failed = data.hcursor.get[String]("error").toOption.exists(_.nonEmpty)
      val status = if failed then "failed" else "done"
      DshStep(List(compaction(sessionId, data, status, title = "Compacting context", detail = None)), fold)
    case "session/title" =>
      val title = data.hcursor.get[String]("title").toOption.map(_.trim).filter(_.nonEmpty)
      DshStep(Nil, fold, title = title)
    case "user/message" | "compaction/prune" | "goal/change" =>
      DshStep(Nil, fold)
    case t if t.startsWith("subagent/") =>
      DshStep(Nil, fold)
    case _ =>
      DshStep(Nil, fold)

def dshEvents(sessionId: String, runId: String, events: List[Json], fold: DshFold = DshFold()): DshStep =
  events.foldLeft(DshStep(Nil, fold)): (acc, ev) =>
    val step = dshEvents(sessionId, runId, ev, acc.fold)
    val ended = step.events.exists:
      case _: RunStateChanged | _: RunFailed => true
      case _                                 => false
    DshStep(
      acc.events ++ step.events,
      step.fold,
      tokensUsed = if ended then step.tokensUsed else acc.tokensUsed,
      title = step.title.orElse(acc.title)
    )

def dshRows(sessionId: String, runId: String, events: List[Json], fromSeq: Long = 0L, fold: DshFold = DshFold()): List[EventRow] =
  dshEvents(sessionId, runId, events, fold).events.zipWithIndex.map: (e, i) =>
    EventRow(fromSeq + i + 1, Json.obj("payload" -> payloadJson(e)).noSpaces)

private def chunkStep(sessionId: String, runId: String, data: Json, fold: DshFold): DshStep =
  val chunk = data.hcursor.downField("chunk").focus.getOrElse(Json.obj())
  val kind = chunk.hcursor.get[String]("type").toOption.getOrElse("")
  kind match
    case "text-delta" =>
      val text = chunk.hcursor.get[String]("text").toOption.getOrElse("")
      DshStep(List(AssistantDelta(sessionId, runId, text, unitOf(data))), fold)
    case "reasoning-delta" =>
      val text = chunk.hcursor.get[String]("text").toOption.getOrElse("")
      DshStep(List(ReasoningDelta(sessionId, runId, text, unitOf(data))), fold)
    case "usage" =>
      val next =
        (for
          k <- turnStep(data)
          u <- usageOf(chunk.hcursor.downField("usage").focus.getOrElse(Json.Null))
        yield fold.copy(usage = fold.usage + (k -> u))).getOrElse(fold)
      DshStep(Nil, next)
    case _ =>
      DshStep(Nil, fold)

private def unitOf(data: Json): Option[String] =
  turnStep(data).map((t, s) => s"$t:$s")

def contentTexts(blocks: List[Json]): String =
  blocks.flatMap: b =>
    if b.hcursor.get[String]("type").toOption.contains("text") then b.hcursor.get[String]("text").toOption
    else None
  .mkString

private def messageText(data: Json): String =
  contentTexts(data.hcursor.downField("message").downField("content").as[List[Json]].toOption.getOrElse(Nil))

def turnStep(data: Json): Option[(Int, Int)] =
  for
    turn <- data.hcursor.get[Int]("turn").toOption
    step <- data.hcursor.get[Int]("step").toOption
  yield (turn, step)

private def usageOf(json: Json): Option[DshUsage] =
  val c = json.hcursor
  val in = c.get[Long]("inputTokens").toOption
  val out = c.get[Long]("outputTokens").toOption
  if in.isEmpty && out.isEmpty then None
  else
    Some(
      DshUsage(
        in.getOrElse(0L),
        out.getOrElse(0L),
        c.get[Long]("cacheReadTokens").toOption.getOrElse(0L),
        c.get[Long]("cacheWriteTokens").toOption.getOrElse(0L)
      )
    )

/** Host `turn/end` reason.kind → river / Finished status. Shared by parent and child. */
def dshEndStatus(kind: String): String =
  kind match
    case "aborted" | "cancelled" => "cancelled"
    case "error" | "interrupted" => "failed"
    case "completed" | "max-tokens" | "blocked" => "completed"
    case other =>
      System.err.println(s"dsh end status unknown kind=$other")
      "completed"

/** Best-effort failure text from a Host turn/end payload (reason.message →
  * reason.error → data.error); never empty so clients always have a message. */
private def endFailureMessage(data: Json): String =
  val reason = data.hcursor.downField("reason")
  List(
    reason.get[String]("message").toOption,
    reason.get[String]("error").toOption,
    data.hcursor.get[String]("error").toOption
  ).flatten.map(_.trim).filter(_.nonEmpty).headOption.getOrElse("dsh turn failed")

/** DSH Host names → existing Fast tool cards. Unknown stays as-is (generic card). */
def dshTool(name: String): String =
  name.trim.toLowerCase match
    case "bash" | "shell" => "shell"
    case "read"           => "read_file"
    case "edit"           => "edit_file"
    case "write"          => "write_file"
    case _                => name

/** Fast approval `risk` from DSH reason; never the opaque `"dsh"` token. */
def dshRisk(tool: String, reason: Option[String]): String =
  val r = reason.getOrElse("").toLowerCase
  if r.contains("outside") || r.contains("escalate") || r.contains("danger-full-access")
    || r.contains("unsandboxed")
  then "external_directory"
  else dshTool(tool) match
    case "shell"                    => "shell"
    case "write_file" | "edit_file" => "workspace_write"
    case _                          => "external_side_effect"

/** Fast approval `context`: path/command from tool/call args, never callId. */
def dshContext(args: Map[String, String]): Option[String] =
  List("file_path", "path", "command", "target")
    .flatMap(k => args.get(k).map(_.trim).filter(_.nonEmpty))
    .headOption

def flatArgs(raw: String): Map[String, String] =
  val base = Map("raw" -> raw)
  io.circe.parser.parse(raw).toOption.flatMap(_.asObject).fold(base): obj =>
    base ++ obj.toMap.flatMap: (k, v) =>
      v.asString
        .orElse(v.asNumber.map(_.toString))
        .orElse(v.asBoolean.map(_.toString))
        .map(k -> _)

private def toolFinished(sessionId: String, runId: String, data: Json): ToolFinished =
  val msg = data.hcursor.downField("message")
  val blocks = msg.downField("content").as[List[Json]].toOption.getOrElse(Nil)
  val callId =
    blocks.headOption.flatMap(_.hcursor.get[String]("toolCallId").toOption)
      .orElse(msg.downField("source").get[String]("callId").toOption)
      .getOrElse("")
  val output = blocks.flatMap: b =>
    b.hcursor.downField("content").as[List[Json]].toOption.getOrElse(Nil).flatMap: inner =>
      inner.hcursor.get[String]("text").toOption
  .mkString
  val failed =
    data.hcursor.downField("error").focus.exists(e => !e.isNull)
      || blocks.exists(_.hcursor.get[Boolean]("isError").toOption.contains(true))
  ToolFinished(sessionId, runId, callId, if failed then "failed" else "success", output = output)

def planTodos(data: Json): List[PlanTodo] =
  data.hcursor.downField("todos").as[List[Json]].toOption.getOrElse(Nil).flatMap: item =>
    val content = item.hcursor.get[String]("content").toOption.map(_.trim).filter(_.nonEmpty)
    val status = item.hcursor.get[String]("status").toOption.flatMap(PlanTodoStatus.parse)
    content.zip(status).map: (c, s) =>
      PlanTodo(todoId(c), c, s)

def todoId(content: String): String =
  val digest = MessageDigest.getInstance("SHA-1")
  digest.digest(content.getBytes(StandardCharsets.UTF_8)).map(b => f"$b%02x").mkString.take(12)

private def patched(sessionId: String, runId: String, action: String, todos: List[PlanTodo]): MessagePatched =
  val payload = PlanPayload(name = "", overview = "", todos = todos, body = "")
  MessagePatched(
    sessionId,
    s"dsh-todo:$sessionId",
    action,
    payload.asJson.noSpaces,
    runId = Some(runId)
  )

private def compaction(sessionId: String, data: Json, status: String, title: String, detail: Option[String]): TaskUpdated =
  val id = data.hcursor.get[String]("compactionId").toOption.filter(_.nonEmpty)
    .getOrElse(s"dsh-compaction:$sessionId")
  TaskUpdated(sessionId, id, "compaction", status, title = title, detail = detail)

private def summaryText(data: Json): Option[String] =
  val parts = data.hcursor.downField("summary").as[List[Json]].toOption.getOrElse(Nil).flatMap: b =>
    b.hcursor.get[String]("text").toOption
  val text = parts.mkString
  if text.isEmpty then None else Some(text)

private def truncate(s: String, n: Int): String =
  if s.length <= n then s else s.take(n)
