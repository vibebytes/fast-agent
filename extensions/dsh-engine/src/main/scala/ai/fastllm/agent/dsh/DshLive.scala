package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.EventRow
import io.circe.Json
import io.circe.syntax.*

/** Snapshot NDJSON only. Sequenced `dsh_tool_card` / `dsh_usage` / `dsh_goal_*` are not in this set. */
val DshSnapshotTypes: Set[String] = Set("dsh_caps", "dsh_queue")

val DshKnownTools: Set[String] = Set("shell", "read_file", "edit_file", "write_file")

def dshKnownTool(name: String): Boolean = DshKnownTools.contains(dshTool(name))

def dshLive(typ: String, fields: (String, Json)*): EventRow =
  EventRow(0L, Json.obj("payload" -> Json.fromFields(("type" -> typ.asJson) +: fields)).noSpaces)

def dshCapsRow(sessionId: String, queue: Boolean, goal: Boolean, budget: Boolean): EventRow =
  dshLive(
    "dsh_caps",
    "sessionId" -> sessionId.asJson,
    "queue" -> queue.asJson,
    "goal" -> goal.asJson,
    "budget" -> budget.asJson,
    "question" -> true.asJson,
    "slash" -> true.asJson
  )

def dshQueueRow(sessionId: String, items: Json): EventRow =
  dshLive("dsh_queue", "sessionId" -> sessionId.asJson, "items" -> items)

def dshQueueText(content: Json): String =
  content.asArray.getOrElse(Vector.empty).flatMap: part =>
    part.hcursor.get[String]("text").toOption.map(_.trim).filter(_.nonEmpty)
  .mkString("\n")

def dshQueueItems(raw: Json): Json =
  Json.fromValues:
    raw.asArray.getOrElse(Vector.empty).flatMap: item =>
      val c = item.hcursor
      for
        id <- c.get[String]("id").toOption.map(_.trim).filter(_.nonEmpty)
        placement <- c.get[String]("placement").toOption
        if placement == "queued" || placement == "steering" || placement == "context"
      yield
        val text = c.downField("message").downField("content").focus
          .orElse(c.downField("content").focus)
          .map(dshQueueText)
          .getOrElse(c.get[String]("text").toOption.getOrElse(""))
        Json.obj("id" -> id.asJson, "placement" -> placement.asJson, "text" -> text.asJson)

def dshToolCardPayload(
    sessionId: String,
    runId: String,
    callId: String,
    name: String,
    title: String,
    args: Map[String, String],
    result: Option[String] = None
): Json =
  val base = Json.obj(
    "type" -> "dsh_tool_card".asJson,
    "sessionId" -> sessionId.asJson,
    "runId" -> runId.asJson,
    "callId" -> callId.asJson,
    "name" -> name.asJson,
    "title" -> title.asJson,
    "args" -> Json.fromFields(args.toList.map((k, v) => k -> v.asJson))
  )
  result.filter(_.nonEmpty).fold(base)(r => base.deepMerge(Json.obj("result" -> r.asJson)))

def dshGoalPayload(sessionId: String, data: Json): Json =
  val goal = data.hcursor.downField("goal").focus.getOrElse(Json.obj())
  Json.obj(
    "type" -> "dsh_goal_changed".asJson,
    "sessionId" -> sessionId.asJson,
    "operation" -> data.hcursor.get[String]("operation").toOption.getOrElse("").asJson,
    "phase" -> goal.hcursor.get[String]("phase").toOption.getOrElse("").asJson,
    "title" -> goal.hcursor.get[String]("title").toOption.orElse(goal.hcursor.get[String]("name").toOption).getOrElse("").asJson,
    "text" -> goal.hcursor.get[String]("text").toOption.orElse(goal.hcursor.get[String]("description").toOption).getOrElse("").asJson
  )

def dshJobStatus(raw: String): String =
  raw.trim.toLowerCase match
    case "running" | "stopping" => "running"
    case "completed"            => "done"
    case "killed" | "failed"    => "failed"
    case other =>
      System.err.println(s"dsh job status unknown kind=$other")
      "running"

final case class ImageLimit(maxBytes: Long = 0, maxCount: Int = 0)

def imageLimitOf(value: Json): ImageLimit =
  val c = value.hcursor
  ImageLimit(
    c.get[Long]("maxBytes").toOption
      .orElse(c.get[Long]("maxSize").toOption)
      .orElse(c.get[Long]("bytes").toOption)
      .getOrElse(0L),
    c.get[Int]("maxCount").toOption
      .orElse(c.get[Int]("maxImages").toOption)
      .orElse(c.get[Int]("count").toOption)
      .getOrElse(0)
  )

def imageOverLimit(images: List[ai.fastllm.agent.channel.AgentAttachProtocol.SubmitImage], limit: ImageLimit): Boolean =
  val count = images.size
  val bytes = images.map(i => math.ceil(i.data.length * 3.0 / 4.0).toLong).sum
  (limit.maxCount > 0 && count > limit.maxCount) || (limit.maxBytes > 0 && bytes > limit.maxBytes)
