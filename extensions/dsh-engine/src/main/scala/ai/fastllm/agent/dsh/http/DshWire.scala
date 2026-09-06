package ai.fastllm.agent.dsh.http

import io.circe.Json
import io.circe.syntax.*

import java.util.UUID

/** Fast dotted alias → Remote slash path. Cohort `@deepseek-ai/dsh@0.1.2-rc.1`. */
val Unary: Map[String, String] =
  Map(
    "session.create" -> "session/create",
    "session.prompt" -> "session/prompt",
    "session.cancel" -> "session/cancel",
    "session.history" -> "session/page",
    "session.page" -> "session/page",
    "session.models" -> "session/modelCatalog",
    "session.selectModel" -> "session/selectModel",
    "session.list" -> "session/list",
    "session.updateQueue" -> "session/updateQueue",
    "session.attachment" -> "session/attachment",
    "session.fork" -> "session/fork",
    "session.rename" -> "session/rename",
    "session.search" -> "session/search",
    "subagent.list" -> "subagents/list",
    "subagent.history" -> "session/page",
    "subagent.prompt" -> "subagents/prompt",
    "subagent.interrupt" -> "subagents/interruptByParent",
    "goal.create" -> "goals/create",
    "goal.edit" -> "goals/edit",
    "goal.pause" -> "goals/pause",
    "goal.resume" -> "goals/resume",
    "goal.complete" -> "goals/complete",
    "goal.clear" -> "goals/clear",
    "skill.list" -> "skills/list",
    "settings.describe" -> "settings/describe",
    "settings.openDocument" -> "settings/openSettingsDocument",
    "settings.update" -> "settings/update",
    "settings.replace" -> "settings/replace",
    "settings.mutate" -> "settings/mutate",
    "credentials.describe" -> "credentials/describe",
    "credentials.set" -> "credentials/set",
    "credentials.unset" -> "credentials/unset",
    "llm.providers" -> "llm/listProviders",
    "llm.models" -> "session/modelCatalog",
    "llm.discoverModels" -> "llm/discoverModels",
    "agentPreset.list" -> "agentPresets/list",
    "agentPreset.select" -> "agentPresets/select",
    "agentPreset.read" -> "agentPresets/read",
    "agentPreset.copy" -> "agentPresets/copy",
    "agentPreset.openDocument" -> "settings/openAgentPresetDirectory",
    "agentPreset.remove" -> "agentPresets/deletePreset",
    "pluginInventory.list" -> "pluginInventory/list",
    "$events.result" -> "$events/result"
  )

val UnaryMethods: Set[String] = Unary.keySet

final case class LiveAttempt(turn: Long, step: Long, attemptId: String)

def remoteOf(method: String): Option[String] = Unary.get(method)

def unaryEnvelope(method: String, payload: Json): Json =
  val slash = remoteOf(method).getOrElse(method.replace('.', '/'))
  Json.obj(
    "type" -> "client-request".asJson,
    "rpcId" -> UUID.randomUUID().toString.asJson,
    "method" -> slash.asJson,
    "payload" -> Json.obj("args" -> argsOf(method, payload))
  )

def peel(status: Int, body: Json): Json =
  if status >= 400 then Json.obj("ok" -> Json.False, "error" -> Json.obj("code" -> "internal".asJson))
  else
    body.hcursor.downField("result").focus match
      case Some(result) =>
        result.hcursor.get[Boolean]("ok") match
          case Right(false) =>
            val err = result.hcursor.downField("error").focus.getOrElse(Json.obj("code" -> "internal".asJson))
            Json.obj("ok" -> Json.False, "error" -> err)
          case _ =>
            Json.obj("ok" -> Json.True, "value" -> result.hcursor.downField("value").focus.getOrElse(Json.obj()))
      case None =>
        body.hcursor.get[Boolean]("ok") match
          case Right(false) => body
          case _            => Json.obj("ok" -> Json.True, "value" -> body.hcursor.downField("value").focus.getOrElse(body))

def muxFrame(raw: Json): Json =
  raw.hcursor.get[String]("type").toOption match
    case Some("server-request") => raw.hcursor.downField("payload").focus.getOrElse(raw)
    case _                      => raw

def argsOf(method: String, payload: Json): Json =
  method match
    case "session.list" =>
      Json.obj("_request" -> payload.hcursor.downField("_request").focus.getOrElse(Json.obj()))
    case "session.models" | "llm.models" | "llm.providers" | "settings.describe" | "settings.openDocument" |
        "pluginInventory.list" | "agentPreset.list" =>
      Json.obj()
    case "session.history" | "session.page" =>
      Json.obj("request" -> pageRequest(payload, child = false))
    case "subagent.history" =>
      Json.obj("request" -> pageRequest(payload, child = true))
    case "session.create" | "session.prompt" | "session.cancel" | "session.selectModel" | "session.updateQueue" |
        "session.attachment" | "session.fork" | "session.rename" | "session.search" | "subagent.prompt" =>
      Json.obj("request" -> payload)
    case "skill.list" =>
      Json.obj("request" -> Json.obj("sessionId" -> str(payload, "sessionId").asJson))
    case "settings.update" | "settings.replace" | "settings.mutate" | "credentials.describe" | "credentials.set" |
        "credentials.unset" | "$events.result" =>
      payload
    case "llm.discoverModels" =>
      val ns = str(payload, "settingsNs") match
        case "" => str(payload, "provider")
        case v  => v
      Json.obj("settingsNs" -> ns.asJson, "request" -> payload)
    case "agentPreset.read" | "agentPreset.openDocument" =>
      Json.obj("agentPreset" -> first(payload, "agentPreset", "id").asJson)
    case "agentPreset.copy" =>
      val base = Json.obj("from" -> str(payload, "from").asJson, "id" -> first(payload, "id", "agentPreset").asJson)
      payload.hcursor.get[String]("name").toOption.filter(_.nonEmpty)
        .fold(base)(n => base.deepMerge(Json.obj("name" -> n.asJson)))
    case "agentPreset.remove" =>
      Json.obj("id" -> first(payload, "id", "agentPreset").asJson)
    case "agentPreset.select" =>
      Json.obj(
        "agentId" -> first(payload, "agentId", "sessionId").asJson,
        "agentPreset" -> str(payload, "agentPreset").asJson
      )
    case "goal.create" =>
      Json.obj("agentId" -> agentId(payload).asJson, "request" -> dropMeta(payload))
    case "goal.edit" =>
      Json.obj("agentId" -> agentId(payload).asJson, "ref" -> refOf(payload), "request" -> dropMeta(payload))
    case g if g.startsWith("goal.") =>
      Json.obj("agentId" -> agentId(payload).asJson, "ref" -> refOf(payload))
    case "subagent.list" =>
      Json.obj("parentSessionId" -> first(payload, "parentSessionId", "sessionId").asJson)
    case "subagent.interrupt" =>
      Json.obj(
        "childSessionId" -> str(payload, "childSessionId").asJson,
        "parentSessionId" -> first(payload, "parentSessionId", "sessionId").asJson,
        "mode" -> payload.hcursor.get[String]("mode").toOption.filter(_.nonEmpty).getOrElse("continuable").asJson
      )
    case _ =>
      Json.obj("request" -> payload)

def pageRequest(payload: Json, child: Boolean, throughSeq: Long): Json =
  val through = payload.hcursor.get[Long]("throughSeq").toOption.getOrElse(throughSeq)
  val childId = str(payload, "childSessionId")
  val address =
    if child || childId.nonEmpty then
      Json.obj(
        "kind" -> "subagent".asJson,
        "parentSessionId" -> first(payload, "parentSessionId", "sessionId").asJson,
        "childSessionId" -> (if childId.nonEmpty then childId else str(payload, "sessionId")).asJson,
        "mode" -> payload.hcursor.get[String]("mode").toOption.filter(_.nonEmpty).getOrElse("continuable").asJson
      )
    else
      Json.obj("kind" -> "session".asJson, "sessionId" -> str(payload, "sessionId").asJson)
  val extra =
    List(
      payload.hcursor.get[Long]("beforeSeq").toOption.map(n => "beforeSeq" -> n.asJson),
      payload.hcursor.get[Int]("maxMessages").toOption.map(n => "maxMessages" -> n.asJson)
    ).flatten
  Json.fromFields(("address" -> address) :: ("throughSeq" -> through.asJson) :: extra)

def pageRequest(payload: Json, child: Boolean): Json =
  pageRequest(payload, child, 0L)

def historyValue(value: Json): Json =
  value.hcursor.downField("records").as[List[Json]] match
    case Right(recs) =>
      val events = recs.map(r => r.hcursor.downField("event").focus.getOrElse(r))
      value.mapObject(_.remove("records").add("events", events.asJson))
    case Left(_) => value

def openFrame(streamId: String, endpoint: String, args: Json = Json.obj()): Json =
  Json.obj(
    "type" -> "open".asJson,
    "streamId" -> streamId.asJson,
    "endpoint" -> endpoint.asJson,
    "payload" -> Json.obj("args" -> args)
  )

def followArgs(sessionId: String): Json =
  Json.obj(
    "request" -> Json.obj(
      "address" -> Json.obj("kind" -> "session".asJson, "sessionId" -> sessionId.asJson),
      "assistantStream" -> Json.True
    )
  )

def projectEvents(frame: Json): List[Json] =
  frame.hcursor.get[String]("type").toOption.getOrElse("") match
    case "emit" =>
      val event = frame.hcursor.get[String]("event").toOption.getOrElse("")
      val args = frame.hcursor.downField("args").as[List[Json]].toOption.getOrElse(Nil)
      event match
        case "api-session/error" =>
          val sid = args.headOption.flatMap(_.asString).getOrElse("")
          val msg = args.lift(1).flatMap(_.asString).getOrElse("api-session/error")
          List(Json.obj("type" -> "host/agent-error".asJson, "sessionId" -> sid.asJson, "message" -> msg.asJson))
        case _ => Nil
    case "waterfall" =>
      val event = frame.hcursor.get[String]("event").toOption.getOrElse("")
      val eventId = frame.hcursor.get[String]("eventId").toOption.getOrElse("")
      val agentId = frame.hcursor.get[String]("agentId").toOption.getOrElse("")
      val request = frame.hcursor.downField("request").focus.getOrElse(Json.obj())
      event match
        case "approval/request" =>
          val extra =
            List(
              request.hcursor.get[String]("callId").toOption.filter(_.nonEmpty).map("callId" -> _.asJson),
              request.hcursor.get[String]("reason").toOption.filter(_.nonEmpty).map("reason" -> _.asJson)
            ).flatten
          List(
            Json.fromFields(
              List(
                "type" -> "approval/requested".asJson,
                "sessionId" -> agentId.asJson,
                "approvalId" -> eventId.asJson,
                "rpcId" -> eventId.asJson,
                "toolName" -> request.hcursor.get[String]("toolName").toOption.getOrElse("").asJson
              ) ++ extra
            )
          )
        case "user-questions/request" =>
          List(
            Json.obj(
              "type" -> "question/requested".asJson,
              "sessionId" -> agentId.asJson,
              "rpcId" -> eventId.asJson
            ).deepMerge(request)
          )
        case _ => Nil
    case "cancel" =>
      val eventId = frame.hcursor.get[String]("eventId").toOption.getOrElse("")
      val sid = frame.hcursor.get[String]("sessionId").toOption.getOrElse("")
      List(
        Json.obj(
          "type" -> "approval/resolved".asJson,
          "sessionId" -> sid.asJson,
          "approvalId" -> eventId.asJson,
          "outcome" -> "cancelled".asJson
        ),
        Json.obj(
          "type" -> "question/resolved".asJson,
          "sessionId" -> sid.asJson,
          "questionRpcId" -> eventId.asJson,
          "outcome" -> "cancelled".asJson
        )
      )
    case _ => Nil

def projectFollow(sessionId: String, frame: Json, live: Option[LiveAttempt]): (List[Json], Option[LiveAttempt]) =
  frame.hcursor.get[String]("type").toOption.getOrElse("") match
    case "snapshot" =>
      val cursor = frame.hcursor.get[Long]("cursor").toOption.getOrElse(0L)
      val records = frame.hcursor.downField("records").as[List[Json]].toOption.getOrElse(Nil)
      val subscribed =
        Json.obj(
          "type" -> "session/subscribed".asJson,
          "sessionId" -> sessionId.asJson,
          "lastSeq" -> cursor.asJson
        )
      val events = records.map: r =>
        sessionEvent(sessionId, r.hcursor.downField("event").focus.getOrElse(r))
      val projections = projectSnapshotProjections(sessionId, frame.hcursor.downField("projections").focus.getOrElse(Json.obj()))
      (subscribed :: events ++ projections, liveFromSnapshot(frame))
    case "event" =>
      (List(sessionEvent(sessionId, frame.hcursor.downField("event").focus.getOrElse(frame))), live)
    case "assistant-stream" =>
      projectAssistant(sessionId, frame.hcursor.downField("frame").focus.getOrElse(Json.obj()), live)
    case _ =>
      frame.hcursor.downField("event").focus match
        case Some(ev) => (List(sessionEvent(sessionId, ev)), live)
        case None     => (Nil, live)

def projectControl(frame: Json): List[Json] =
  frame.hcursor.get[String]("type").toOption.getOrElse("") match
    case "baseline" =>
      val value = frame.hcursor.downField("value").focus.getOrElse(Json.obj())
      objectRows(value, "queues").map: (sid, items) =>
        Json.obj("type" -> "session/queue".asJson, "sessionId" -> sid.asJson, "items" -> items)
      ++ objectRows(value, "jobs").map: (sid, jobs) =>
        Json.obj("type" -> "session/jobs".asJson, "sessionId" -> sid.asJson, "jobs" -> jobs)
      ++ objectRows(value, "projections").flatMap: (sid, baseline) =>
        projectSnapshotProjections(sid, baseline)
    case "queue" =>
      frame.hcursor.get[String]("sessionId").toOption.toList.map: sid =>
        Json.obj(
          "type" -> "session/queue".asJson,
          "sessionId" -> sid.asJson,
          "items" -> frame.hcursor.downField("items").focus.getOrElse(Json.arr())
        )
    case "jobs" =>
      frame.hcursor.get[String]("sessionId").toOption.toList.map: sid =>
        Json.obj(
          "type" -> "session/jobs".asJson,
          "sessionId" -> sid.asJson,
          "jobs" -> frame.hcursor.downField("jobs").focus.getOrElse(Json.arr())
        )
    case "projection" =>
      (for
        sid <- frame.hcursor.get[String]("sessionId").toOption
        key <- frame.hcursor.get[String]("key").toOption
        value <- frame.hcursor.downField("value").focus
      yield Json.obj(
        "type" -> "session/projection".asJson,
        "sessionId" -> sid.asJson,
        "key" -> key.asJson,
        "value" -> value
      )).toList
    case _ => Nil

def snapshotHistory(sessionId: String, frame: Json): Json =
  val records = frame.hcursor.downField("records").as[List[Json]].toOption.getOrElse(Nil)
  val events = records.map(r => r.hcursor.downField("event").focus.getOrElse(r))
  Json.obj(
    "events" -> events.asJson,
    "hasMore" -> frame.hcursor.get[Boolean]("hasMore").toOption.getOrElse(false).asJson,
    "lastSeq" -> frame.hcursor.get[Long]("cursor").toOption.getOrElse(0L).asJson,
    "sessionId" -> sessionId.asJson
  )

def eventResultArgs(clientId: String, eventId: String, value: Json, rejected: Boolean): Json =
  val outcome =
    if rejected then
      Json.obj(
        "kind" -> "rejected".asJson,
        "error" -> Json.obj("name" -> "Error".asJson, "message" -> "cancelled".asJson)
      )
    else
      value.hcursor.downField("outcome").focus match
        case Some(o) if o.hcursor.get[String]("kind").toOption.exists(_.nonEmpty) => o
        case Some(o) =>
          o.asString match
            case Some(s) => Json.obj("kind" -> "result".asJson, "value" -> s.asJson)
            case None    => Json.obj("kind" -> "result".asJson, "value" -> o)
        case None =>
          Json.obj("kind" -> "result".asJson, "value" -> value)
  Json.obj("clientId" -> clientId.asJson, "eventId" -> eventId.asJson, "outcome" -> outcome)

def childIds(value: Json): List[String] =
  value.hcursor.downField("entries").as[List[Json]].toOption.getOrElse(Nil).flatMap: e =>
    val kind = e.hcursor.get[String]("kind").toOption.getOrElse("child")
    if kind == "child" then e.hcursor.get[String]("id").toOption.map(_.trim).filter(_.nonEmpty)
    else None

private def projectAssistant(
    sessionId: String,
    frame: Json,
    live: Option[LiveAttempt]
): (List[Json], Option[LiveAttempt]) =
  frame.hcursor.get[String]("type").toOption.getOrElse("") match
    case "start" =>
      val next = LiveAttempt(
        frame.hcursor.get[Long]("turn").toOption.getOrElse(0L),
        frame.hcursor.get[Long]("step").toOption.getOrElse(0L),
        frame.hcursor.get[String]("attemptId").toOption.getOrElse("")
      )
      (Nil, Some(next))
    case "chunk" =>
      val turn = live.map(_.turn).orElse(frame.hcursor.get[Long]("turn").toOption).getOrElse(0L)
      val step = live.map(_.step).orElse(frame.hcursor.get[Long]("step").toOption).getOrElse(0L)
      val ev = Json.obj(
        "type" -> "assistant/chunk".asJson,
        "time" -> frame.hcursor.get[Long]("time").toOption.getOrElse(0L).asJson,
        "data" -> Json.obj(
          "turn" -> turn.asJson,
          "step" -> step.asJson,
          "chunk" -> frame.hcursor.downField("chunk").focus.getOrElse(Json.obj())
        )
      )
      (List(sessionEvent(sessionId, ev)), live)
    case "end" => (Nil, None)
    case _     => (Nil, live)

private def liveFromSnapshot(frame: Json): Option[LiveAttempt] =
  val active = frame.hcursor.downField("assistantStream").downField("activeAttempt")
  for
    attemptId <- active.get[String]("attemptId").toOption
    turn <- active.get[Long]("turn").toOption
    step <- active.get[Long]("step").toOption
  yield LiveAttempt(turn, step, attemptId)

private def projectSnapshotProjections(sessionId: String, baseline: Json): List[Json] =
  baseline.hcursor.downField("values").focus.flatMap(_.asObject).toList.flatMap: obj =>
    obj.toList.map: (key, value) =>
      Json.obj(
        "type" -> "session/projection".asJson,
        "sessionId" -> sessionId.asJson,
        "key" -> key.asJson,
        "value" -> value
      )

private def sessionEvent(sessionId: String, event: Json): Json =
  Json.obj("type" -> "session/event".asJson, "sessionId" -> sessionId.asJson, "event" -> event)

private def objectRows(value: Json, field: String): List[(String, Json)] =
  value.hcursor.downField(field).focus.flatMap(_.asObject).toList.flatMap(_.toList)

private def str(payload: Json, field: String): String =
  payload.hcursor.get[String](field).toOption.map(_.trim).getOrElse("")

private def first(payload: Json, fields: String*): String =
  fields.iterator.map(str(payload, _)).find(_.nonEmpty).getOrElse("")

private def agentId(payload: Json): String = first(payload, "agentId", "sessionId")

private def refOf(payload: Json): Json =
  payload.hcursor.downField("ref").focus.filter(_.isObject).getOrElse:
    Json.obj(
      "id" -> first(payload, "id", "goalId").asJson,
      "revision" -> payload.hcursor.get[Long]("revision").toOption.getOrElse(0L).asJson
    )

private def dropMeta(payload: Json): Json =
  val keys = List("sessionId", "agentId", "ref", "id", "goalId", "revision")
  payload.mapObject(obj => keys.foldLeft(obj)(_.remove(_)))
