package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.{ChannelMessage, ChannelMessageWindow, MessageRole, MessageType}
import ai.fastllm.agent.message.PlanPayload
import io.circe.Json
import io.circe.syntax.*

final case class DshHistory(
    rows: List[ChannelMessage],
    title: Option[String],
    lastSeq: Option[Long]
)

/** Peel `session.history` value.events into raw SessionEvents. */
def historyEvents(value: Json): List[Json] =
  value.hcursor.downField("events").as[List[Json]].toOption.getOrElse(Nil).map: item =>
    item.hcursor.downField("event").focus.getOrElse(item)

/** Linear restore: user/assistant/tools; last open todo → Plan; title out of band; compaction skipped. */
def dshHistory(sessionId: String, events: List[Json]): DshHistory =
  val acc = events.foldLeft(RestoreAcc()): (a, raw) =>
    val ev = raw.hcursor.downField("payload").downField("event").focus.getOrElse(raw)
    val seq = ev.hcursor.get[Long]("seq").toOption
    val t = ev.hcursor.get[String]("type").toOption.getOrElse("")
    val data = ev.hcursor.downField("data").focus.getOrElse(Json.obj())
    val numbered = a.copy(lastSeq = seq.orElse(a.lastSeq))
    t match
      case s if s.startsWith("compaction/") => numbered
      case s if s.startsWith("subagent/")   => numbered
      case "goal/change" | "llm/retry" | "llm/retry-started" => numbered
      case "session/title" =>
        numbered.copy(title = data.hcursor.get[String]("title").toOption.map(_.trim).filter(_.nonEmpty).orElse(numbered.title))
      case "todo/write" =>
        numbered.copy(todo = Some(data), todoOpen = true)
      case "turn/start" =>
        flush(sessionId, numbered, seq).copy(todoOpen = false, step = None)
      case "user/message" =>
        val flushed = flush(sessionId, numbered, seq)
        flushed.copy(rows = flushed.rows :+ row(sessionId, idOf(seq, "u"), "user", "text", texts(data)), step = None)
      case "assistant/message" =>
        ingestMessage(sessionId, numbered, seq, data)
      case "assistant/chunk" =>
        ingestChunk(sessionId, numbered, seq, data)
      case "tool/call" =>
        val flushed = flush(sessionId, numbered, seq)
        flushed.copy(rows = flushed.rows :+ toolCall(sessionId, seq, data), step = turnStep(data).orElse(flushed.step))
      case "tool/result" =>
        val flushed = flush(sessionId, numbered, seq)
        flushed.copy(rows = flushed.rows :+ toolResult(sessionId, seq, data))
      case "turn/end" =>
        flush(sessionId, numbered, seq).copy(step = None)
      case _ =>
        numbered
  val withPlan =
    if acc.todoOpen then acc.todo.flatMap(planRow(sessionId, _)).fold(acc)(p => acc.copy(rows = acc.rows :+ p))
    else acc
  DshHistory(withPlan.rows.toList, withPlan.title, withPlan.lastSeq)

def dshWindow(rows: List[ChannelMessage], beforeTurnId: Option[String], limit: Int): ChannelMessageWindow =
  val lim = if limit <= 0 then 20 else limit
  val anchors = rows.zipWithIndex.filter(_._1.role == MessageRole.text(MessageRole.User))
  if anchors.isEmpty then
    ChannelMessageWindow(rows, hasMoreOlder = false, totalExchangeCount = if rows.nonEmpty then 1 else 0)
  else
    val total = anchors.size
    beforeTurnId.filter(_.nonEmpty) match
      case None =>
        if total <= lim then ChannelMessageWindow(rows, false, total)
        else
          val start = anchors(total - lim)._2
          ChannelMessageWindow(rows.drop(start), true, total)
      case Some(id) =>
        val idx = anchors.indexWhere(_._1.id == id)
        if idx <= 0 then ChannelMessageWindow(Nil, false, total)
        else
          val earlier = anchors.take(idx)
          val page = if earlier.size <= lim then earlier else earlier.takeRight(lim)
          val start = page.head._2
          val end = anchors(idx)._2
          ChannelMessageWindow(rows.slice(start, end), earlier.size > lim, total)

private case class RestoreAcc(
    rows: Vector[ChannelMessage] = Vector.empty,
    title: Option[String] = None,
    lastSeq: Option[Long] = None,
    todo: Option[Json] = None,
    todoOpen: Boolean = false,
    text: String = "",
    reasoning: String = "",
    fromMessage: Boolean = false,
    step: Option[(Int, Int)] = None
)

private def ingestChunk(sessionId: String, acc: RestoreAcc, seq: Option[Long], data: Json): RestoreAcc =
  val stepped = switchStep(sessionId, acc, seq, data)
  val chunk = data.hcursor.downField("chunk").focus.getOrElse(Json.obj())
  val kind = chunk.hcursor.get[String]("type").toOption.getOrElse("")
  val piece = chunk.hcursor.get[String]("text").toOption.getOrElse("")
  kind match
    case "text-delta" if !stepped.fromMessage => stepped.copy(text = stepped.text + piece)
    case "reasoning-delta"                    => stepped.copy(reasoning = stepped.reasoning + piece)
    case _                                    => stepped

private def ingestMessage(sessionId: String, acc: RestoreAcc, seq: Option[Long], data: Json): RestoreAcc =
  val stepped = switchStep(sessionId, acc, seq, data)
  val body = data.hcursor.downField("message").focus.getOrElse(data)
  stepped.copy(text = texts(body), fromMessage = true)

private def switchStep(sessionId: String, acc: RestoreAcc, seq: Option[Long], data: Json): RestoreAcc =
  val next = turnStep(data)
  val flushed =
    if next.exists(k => acc.step.exists(_ != k)) then flush(sessionId, acc, seq)
    else acc
  flushed.copy(step = next.orElse(flushed.step))

private def flush(sessionId: String, acc: RestoreAcc, seq: Option[Long]): RestoreAcc =
  val reason =
    if acc.reasoning.isEmpty then None
    else Some(row(sessionId, idOf(seq, "r"), "assistant", MessageType.text(MessageType.Reasoning), acc.reasoning))
  val answer =
    if acc.text.isEmpty then None
    else Some(row(sessionId, idOf(seq, "a"), "assistant", MessageType.text(MessageType.Text), acc.text))
  acc.copy(
    rows = acc.rows ++ reason ++ answer,
    text = "",
    reasoning = "",
    fromMessage = false
  )

private def toolCall(sessionId: String, seq: Option[Long], data: Json): ChannelMessage =
  val id = data.hcursor.get[String]("callId").toOption.getOrElse("")
  val name = dshTool(data.hcursor.get[String]("name").toOption.getOrElse(""))
  val raw = data.hcursor.get[String]("arguments").toOption.getOrElse("")
  val args = flatArgs(raw).foldLeft(Json.obj()) { (j, kv) => j.mapObject(_.add(kv._1, kv._2.asJson)) }
  val payload = Json.obj(
    "tool_calls" -> Json.arr(
      Json.obj("id" -> id.asJson, "name" -> name.asJson, "arguments" -> args)
    )
  )
  ChannelMessage(
    id = idOf(seq, "c"),
    sessionId = sessionId,
    role = MessageRole.text(MessageRole.Assistant),
    messageType = MessageType.text(MessageType.Text),
    content = Some(""),
    payloadJson = Some(payload.noSpaces),
    toolCallId = Option(id).filter(_.nonEmpty),
    toolName = Option(name).filter(_.nonEmpty)
  )

private def toolResult(sessionId: String, seq: Option[Long], data: Json): ChannelMessage =
  val finished = toolOutput(data)
  ChannelMessage(
    id = idOf(seq, "t"),
    sessionId = sessionId,
    role = MessageRole.text(MessageRole.Tool),
    messageType = MessageType.text(MessageType.ToolResult),
    content = Some(finished._3),
    toolCallId = Option(finished._1).filter(_.nonEmpty),
    status = Some(finished._2)
  )

private def toolOutput(data: Json): (String, String, String) =
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
  (callId, if failed then "failed" else "success", output)

private def planRow(sessionId: String, data: Json): Option[ChannelMessage] =
  val todos = planTodos(data)
  if todos.isEmpty then None
  else
    val payload = PlanPayload(name = "", overview = "", todos = todos, body = "")
    Some(
      ChannelMessage(
        id = s"dsh-todo:$sessionId",
        sessionId = sessionId,
        role = MessageRole.text(MessageRole.Assistant),
        messageType = MessageType.text(MessageType.Plan),
        content = Some(""),
        payloadJson = Some(payload.asJson.noSpaces)
      )
    )

private def row(sessionId: String, id: String, role: String, messageType: String, content: String): ChannelMessage =
  ChannelMessage(id = id, sessionId = sessionId, role = role, messageType = messageType, content = Some(content))

private def texts(json: Json): String =
  contentTexts(json.hcursor.downField("content").as[List[Json]].toOption.getOrElse(Nil))

private def idOf(seq: Option[Long], tag: String): String =
  seq.map(s => s"dsh-$s-$tag").getOrElse(s"dsh-$tag")
