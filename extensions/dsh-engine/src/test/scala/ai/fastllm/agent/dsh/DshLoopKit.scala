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

/** DshLoopSpec fixtures. Mixed into the suite barrel. */
trait DshLoopKit:
  this: AnyFunSuite & Matchers =>
  val Sid = "sess-1"
  val Cwd = "/tmp/proj"
  def chunkJson(seq: Long, text: String): Json =
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

  def catalog(entries: Json*): Json =
    Json.obj(
      "ok" -> Json.True,
      "value" -> Json.obj("entries" -> Json.fromValues(entries.toList), "parentAvailable" -> Json.True)
    )

  def childEntry(id: String, activity: String, mode: String, label: String = ""): Json =
    val base = Json.obj(
      "kind" -> "child".asJson,
      "id" -> id.asJson,
      "activity" -> activity.asJson,
      "mode" -> mode.asJson
    )
    if label.isEmpty then base else base.deepMerge(Json.obj("label" -> label.asJson))

  def submit(clientId: String, text: String) =
    AgentAttachProtocol.Command.SubmitUserMessage(Sid, clientId, text)

  def await[A](f: Future[A]): A = Await.result(f, 2.seconds)

  def methods(remote: FakeClient): List[String] = remote.calls.map(_._1).toList

  def modeOf(payload: Json): String =
    payload.hcursor.get[String]("mode").toOption.getOrElse("")

  def createCwd(payload: Json): String =
    payload.hcursor.get[String]("cwd").toOption.getOrElse("")

  def createSessionId(payload: Json): String =
    payload.hcursor.get[String]("sessionId").toOption.getOrElse("")

  def createWorkspaceId(payload: Json): String =
    payload.hcursor.get[String]("workspaceId").toOption.getOrElse("")

  def payloadType(row: EventRow): String =
    parse(row.envelopeJson).toOption.flatMap(_.hcursor.downField("payload").get[String]("type").toOption).getOrElse("")

  def payloadTypes(rows: List[EventRow]): List[String] =
    rows.filter(_.seq > 0).map(payloadType)

  def liveTypes(rows: List[EventRow]): Set[String] =
    rows.filter(_.seq == 0).map(payloadType).toSet

  def payloadString(row: EventRow, field: String): String =
    parse(row.envelopeJson).toOption.flatMap(_.hcursor.downField("payload").get[String](field).toOption).getOrElse("")

  def payloadOpt(row: EventRow, field: String): Option[String] =
    parse(row.envelopeJson).toOption.flatMap(_.hcursor.downField("payload").get[String](field).toOption)

  def ev(tpe: String, seq: Long, data: String, time: Long = -1L): Json =
    val at = if time < 0 then seq else time
    parse(s"""{"type":"$tpe","seq":$seq,"time":$at,"data":$data}""").fold(e => fail(e.message), identity)

  def userSource(seq: Long, kind: String, sender: String, time: Long = -1L): Json =
    ev(
      "user/message",
      seq,
      s"""{"source":{"kind":"$kind","form":"notice","senderSessionId":"$sender"}}""",
      time
    )

  def chunk(seq: Long, text: String): Json =
    ev("assistant/chunk", seq, s"""{"turn":1,"step":1,"chunk":{"type":"text-delta","index":0,"text":"$text"}}""")

  def usageChunk(seq: Long): Json =
    ev(
      "assistant/chunk",
      seq,
      """{"turn":1,"step":1,"chunk":{"type":"usage","usage":{"inputTokens":10,"outputTokens":4,"cacheReadTokens":3,"cacheWriteTokens":2}}}"""
    )

  def payloadLong(row: EventRow, field: String): Option[Long] =
    parse(row.envelopeJson).toOption.flatMap(_.hcursor.downField("payload").get[Long](field).toOption)

  def historyOf(name: String): Json =
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

private[dsh] class FakeClient extends Client:
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
  var childHistory: Json =
    Json.obj("ok" -> Json.True, "value" -> Json.obj("events" -> Json.arr(), "hasMore" -> Json.False))
  var listHold: Option[Promise[Json]] = None
  var readyFail: Option[Throwable] = None

  def call(method: String, payload: Json): Future[Json] =
    calls = calls :+ (method -> payload)
    method match
      case "session.create"    => Future.successful(create)
      case "session.prompt"    => Future.successful(prompt)
      case "session.cancel"    => Future.successful(cancel)
      case "session.history"   => Future.successful(history)
      case "subagent.history"  => Future.successful(childHistory)
      case "subagent.list"     => listHold.map(_.future).getOrElse(Future.successful(list))
      case _                   => Future.successful(Json.obj("ok" -> Json.True, "value" -> Json.obj()))

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
  def ready: Future[Unit] = readyFail.fold(Future.unit)(Future.failed)
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

private[dsh] class DummyLoop extends AgentLoop:
  val caps: Caps = Caps(cancel = true, approval = true, answerQuestion = true, restore = true)
  def submit(cmd: AgentAttachProtocol.Command.SubmitUserMessage): Future[Admit] =
    Future.successful(Admit.Rejected("fast"))
  def cancel(cmd: AgentAttachProtocol.Command.CancelRun): Future[Admit] =
    Future.successful(Admit.Rejected("fast"))
  def decide(cmd: AgentAttachProtocol.Command.DecideApproval): Future[RouteResult] =
    Future.successful(RouteResult("rejected", "", "fast"))
  override def answer(cmd: AgentAttachProtocol.Command.AnswerQuestionBatch): Future[RouteResult] =
    Future.successful(RouteResult("rejected", "", "fast_question_batch"))
  def events(sessionId: String, afterSeq: Long): Future[List[EventRow]] = Future.successful(Nil)
