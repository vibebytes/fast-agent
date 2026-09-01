package ai.fastllm.agent.dsh

import io.circe.Json

enum Mux:
  case Event(sessionId: String, event: Json)
  case ApprovalAsked(
      sessionId: String,
      rpcId: String,
      approvalId: String,
      tool: String,
      reason: Option[String] = None,
      callId: Option[String] = None
  )
  case ApprovalDone(sessionId: String, approvalId: String, outcome: String)
  case QuestionAsked(sessionId: String, rpcId: String, payload: Json)
  case QuestionDone(sessionId: String, questionRpcId: String, outcome: String)
  case Subscribed(sessionId: String, lastSeq: Long)
  case Queue(sessionId: String, items: Json)
  case Jobs(sessionId: String, jobs: Json)
  case Projection(sessionId: String, key: String, value: Json)
  case Failed(message: String)

/** MuxFrame JSON, or a `server-request` envelope wrapping one. Envelope `rpcId` is copied onto asked frames. */
def muxOf(json: Json, rpc: String = ""): Option[Mux] =
  json.hcursor.get[String]("type").toOption.getOrElse("") match
    case "server-request" =>
      val next = json.hcursor.get[String]("rpcId").toOption.filter(_.nonEmpty).getOrElse(rpc)
      json.hcursor.downField("payload").focus.flatMap(muxOf(_, next))
    case "session/event" =>
      for
        sid <- json.hcursor.get[String]("sessionId").toOption
        ev <- json.hcursor.downField("event").focus
      yield Mux.Event(sid, ev)
    case "session/subscribed" =>
      for
        sid <- json.hcursor.get[String]("sessionId").toOption
        last <- json.hcursor.get[Long]("lastSeq").toOption
      yield Mux.Subscribed(sid, last)
    case "approval/requested" =>
      for
        sid <- json.hcursor.get[String]("sessionId").toOption
        id <- json.hcursor.get[String]("approvalId").toOption
        tool <- json.hcursor.get[String]("toolName").toOption
      yield Mux.ApprovalAsked(
        sid,
        json.hcursor.get[String]("rpcId").toOption.filter(_.nonEmpty).getOrElse(rpc),
        id,
        tool,
        json.hcursor.get[String]("reason").toOption.filter(_.nonEmpty),
        json.hcursor.get[String]("callId").toOption.filter(_.nonEmpty)
      )
    case "approval/resolved" =>
      for
        sid <- json.hcursor.get[String]("sessionId").toOption
        id <- json.hcursor.get[String]("approvalId").toOption
        out <- json.hcursor.get[String]("outcome").toOption
      yield Mux.ApprovalDone(sid, id, out)
    case "question/requested" =>
      json.hcursor.get[String]("sessionId").toOption.map: sid =>
        Mux.QuestionAsked(
          sid,
          json.hcursor.get[String]("rpcId").toOption.filter(_.nonEmpty).getOrElse(rpc),
          json
        )
    case "question/resolved" =>
      for
        sid <- json.hcursor.get[String]("sessionId").toOption
        qid <- json.hcursor.get[String]("questionRpcId").toOption.filter(_.nonEmpty)
        out <- json.hcursor.get[String]("outcome").toOption.filter(_.nonEmpty)
      yield Mux.QuestionDone(sid, qid, out)
    case "session/queue" =>
      json.hcursor.get[String]("sessionId").toOption.map: sid =>
        Mux.Queue(sid, json.hcursor.downField("items").focus.getOrElse(Json.arr()))
    case "session/jobs" =>
      json.hcursor.get[String]("sessionId").toOption.map: sid =>
        Mux.Jobs(sid, json.hcursor.downField("jobs").focus.getOrElse(Json.arr()))
    case "session/projection" =>
      for
        sid <- json.hcursor.get[String]("sessionId").toOption
        key <- json.hcursor.get[String]("key").toOption
        value <- json.hcursor.downField("value").focus
      yield Mux.Projection(sid, key, value)
    case "stream/error" =>
      val msg =
        json.hcursor.downField("error").get[String]("message").toOption
          .orElse(json.hcursor.downField("error").get[String]("code").toOption)
          .getOrElse("stream/error")
      Some(Mux.Failed(msg))
    case _ => None
