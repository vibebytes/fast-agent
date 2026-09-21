package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.AgentAttachProtocol.Command.{AnswerQuestionBatch, QuestionBatchAnswer}
import ai.fastllm.agent.channel.AgentAttachProtocol.Event.{
  ApprovalExpired, ApprovalRequested, ApprovalResolved, QuestionBatchIntent, QuestionBatchItem,
  QuestionBatchOption, QuestionBatchRequested, QuestionBatchResolved, RunCancelled, RunCompleted,
  RunCreated, RunFailed, RunStateChanged, CheckpointEvent, ChildTranscriptDelta, SubagentFinished,
  SubagentStarted, SubagentUpdated, TaskUpdated, ToolStarted
}
import ai.fastllm.agent.channel.{
  Admit, AgentAttachProtocol, AgentEvent, EventRow, IngressOffer, RouteResult, payloadJson
}
import io.circe.Json
import io.circe.syntax.*
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}
import scala.util.control.NonFatal

/** Belong to [[DshLoop]]. Submit / turn claim / row write. */
trait DshSubmit:
  this: DshLoop =>
  private given ExecutionContext = dshExec

  def submit(cmd: AgentAttachProtocol.Command.SubmitUserMessage): Future[Admit] =
    if cmd.skillSlash.isDefined then Future.successful(Admit.Rejected("dsh_slash"))
    else
      val cwd = Option(cwdOf(cmd.sessionId)).map(_.trim).getOrElse("")
      log.info(s"dsh submit session=${cmd.sessionId} cwd=$cwd")
      if cwd.isEmpty then Future.successful(Admit.Rejected("cwd missing"))
      else
        remote.ready.flatMap(_ => ensure(cmd.sessionId, cwd)).flatMap:
          case Left(err) =>
            Future.successful(Admit.Rejected(err.hcursor.get[String]("code").toOption.getOrElse("error")))
          case Right(_) =>
            if imageOverLimit(cmd.images, snapshot(cmd.sessionId).map(_.imageLimit).getOrElse(ImageLimit())) then
              Future.successful(Admit.Rejected("imageLimits"))
            else
              liveOf(cmd.sessionId) match
                case Some(live) =>
                  prompt(cmd.sessionId, "queue", cmd.text, cmd.images, cmd.clientMessageId).map:
                    case Right(_) => Admit.Steered(live)
                    case Left(e)  => Admit.Rejected(e)
                case None =>
                  drain(cmd.sessionId).flatMap(_ => startTurn(cmd))

  private[dsh] def prompt(
      sessionId: String,
      mode: String,
      text: String,
      images: List[AgentAttachProtocol.SubmitImage] = Nil,
      requestId: String
  ): Future[Either[String, Unit]] =
    val parts =
      Json.obj("type" -> "text".asJson, "text" -> text.asJson) +:
        images.map: i =>
          Json.obj("type" -> "image".asJson, "mediaType" -> i.mediaType.asJson, "data" -> i.data.asJson)
    remote.call(
      "session.prompt",
      Json.obj(
        "sessionId" -> sessionId.asJson,
        "mode" -> mode.asJson,
        "content" -> Json.fromValues(parts),
        "requestId" -> requestId.asJson
      )
    ).map(json => valueOf(json).map(_ => ()))

  private[dsh] def appendTerminal(sessionId: String, runId: String, status: String): Unit =
    lock.synchronized:
      offerSerial(sessionId, riverOf(List(RunStateChanged(sessionId, runId, status)), Some(runId)))
    settle(sessionId, runId)

  private[dsh] def settle(sessionId: String, runId: String): Unit =
    val ids = lock.synchronized:
      bindings.get(sessionId) match
        case Some(b) =>
          val taken = b.toolCallIds
          bindings = bindings.updated(sessionId, b.copy(toolCallIds = Vector.empty, toolArgs = Map.empty))
          taken
        case None => Vector.empty
    log.info(s"dsh run settled sid=$sessionId run=$runId toolIds=${ids.size}")
    attachEnding(sessionId, onTurnEnd(sessionId, runId, ids))

  private[dsh] def drain(sessionId: String): Future[Unit] =
    snapshot(sessionId).flatMap(_.ending).filterNot(_.isCompleted).getOrElse(Future.unit)

  private[dsh] def startTurn(cmd: AgentAttachProtocol.Command.SubmitUserMessage): Future[Admit] =
    liveOf(cmd.sessionId) match
      case Some(live) =>
        prompt(cmd.sessionId, "queue", cmd.text, cmd.images, cmd.clientMessageId).map:
          case Right(_) => Admit.Accepted(live)
          case Left(e)  => Admit.Rejected(e)
      case None =>
        val runId = s"${cmd.sessionId}:${cmd.clientMessageId}"
        if !claimLive(cmd.sessionId, runId) then
          liveOf(cmd.sessionId) match
            case Some(live) =>
              prompt(cmd.sessionId, "queue", cmd.text, cmd.images, cmd.clientMessageId).map:
                case Right(_) => Admit.Accepted(live)
                case Left(e)  => Admit.Rejected(e)
            case None => Future.successful(Admit.Rejected("cwd missing"))
        else
          onTurnBegin(cmd.sessionId, runId).transformWith:
            case Failure(e) =>
              log.error(s"dsh turn begin capture failed session=${cmd.sessionId} run=$runId: ${e.getMessage}", e)
              afterBegin(cmd.sessionId, runId, cmd.text, cmd.images, cmd.clientMessageId)
            case Success(_) =>
              afterBegin(cmd.sessionId, runId, cmd.text, cmd.images, cmd.clientMessageId)

  private[dsh] def afterBegin(
      sessionId: String,
      runId: String,
      text: String,
      images: List[AgentAttachProtocol.SubmitImage],
      requestId: String
  ): Future[Admit] =
    if liveOf(sessionId).contains(runId) then
      prompt(sessionId, "queue", text, images, requestId).transform:
        case Success(Right(_)) => Success(Admit.Accepted(runId))
        case Success(Left(e)) =>
          failAdmitted(sessionId, runId, e)
          Success(Admit.Rejected(e))
        case Failure(e) =>
          val message = Option(e.getMessage).filter(_.nonEmpty).getOrElse("prompt")
          failAdmitted(sessionId, runId, message)
          Success(Admit.Rejected(message))
    else
      settle(sessionId, runId)
      Future.successful(Admit.Rejected("cancelled"))

  /** Prompt RPC failed after the run was claimed — append a real RunFailed so
    * BusyRoots clear and clients render an error card. Without it the run stays
    * busy forever when the child never delivers turn/end (e.g. LLM auth/balance
    * failures), and every later RerunRun is rejected with session_busy. */
  private[dsh] def failAdmitted(sessionId: String, runId: String, message: String): Unit =
    lock.synchronized:
      if liveOf(sessionId).contains(runId) then
        offerSerial(sessionId, List(RunFailed(sessionId, runId, message)))
    settle(sessionId, runId)

  private[dsh] def attachEnding(sessionId: String, end: Future[Unit]): Unit =
    val fused = lock.synchronized:
      bindings.get(sessionId) match
        case None => end
        case Some(b) =>
          val next = b.ending.filterNot(_.isCompleted).fold(end)(_.flatMap(_ => end))
          bindings = bindings.updated(sessionId, b.copy(ending = Some(next)))
          next
    fused.onComplete:
      case Failure(e) =>
        log.error(s"dsh turn end capture failed session=$sessionId: ${e.getMessage}", e)
        clearEnding(sessionId)
      case Success(_) =>
        clearEnding(sessionId)

  private[dsh] def clearEnding(sessionId: String): Unit =
    lock.synchronized:
      bindings.get(sessionId).foreach: cur =>
        if cur.ending.exists(_.isCompleted) then
          bindings = bindings.updated(sessionId, cur.copy(ending = None))

  private[dsh] def claimLive(sessionId: String, runId: String): Boolean =
    lock.synchronized:
      bindings.get(sessionId) match
        case Some(b) if b.liveRunId.isDefined => false
        case Some(b) =>
          bindings = bindings.updated(
            sessionId,
            b.copy(
              liveRunId = Some(runId),
              toolCallIds = Vector.empty,
              toolArgs = Map.empty,
              liveSinceMs = nowMs(),
              lastEventMs = nowMs()
            )
          )
          log.info(s"dsh run claimed sid=$sessionId run=$runId")
          true
        case None => false

  private[dsh] def rowsOf(b: Binding, events: List[AgentEvent]): Binding =
    writeInto(b, events)

  private[dsh] def offerSerial(sessionId: String, events: List[AgentEvent]): Unit =
    if events.nonEmpty then
      ingress.offer(IngressOffer(sessionId, sessionId, None, None, false, DshBatch(sessionId, events)))

  private[dsh] def writeInto(b: Binding, events: List[AgentEvent]): Binding =
    events.foldLeft(b): (cur, e) =>
      e match
        case t: TaskUpdated => writeUi(cur, t)
        case ToolStarted(sid, rid, id, name, a) if !dshKnownTool(name) =>
          val after = writeRow(cur, payloadJson(e), e)
          writeRow(after, dshToolCardPayload(sid, rid, id, name, name, a), e, track = false)
        case _ => writeRow(cur, payloadJson(e), e)

  private[dsh] def writeRow(cur: Binding, payload: Json, e: AgentEvent, track: Boolean = true): Binding =
    val liveNext = e match
      case RunStateChanged(_, rid, _, _, _) if cur.liveRunId.contains(rid) => None
      case RunCompleted(_, rid, _) if cur.liveRunId.contains(rid) => None
      case RunCancelled(_, rid, _, _) if cur.liveRunId.contains(rid) => None
      case RunFailed(_, rid, _, _, _) if cur.liveRunId.contains(rid) => None
      case _                                                         => cur.liveRunId
    val (ids, args) = e match
      case ToolStarted(_, _, id, _, a) if track && id.nonEmpty =>
        (cur.toolCallIds :+ id, dshContext(a).fold(cur.toolArgs)(s => cur.toolArgs.updated(id, s)))
      case _ => (cur.toolCallIds, cur.toolArgs)
    cur.copy(
      liveRunId = liveNext,
      toolCallIds = ids,
      toolArgs = args,
      lastEventMs = nowMs(),
      rows = appendRows(cur, List(payload))
    )

  /** River lane: core numbers the rows. A failed append drops the row, never the order. */
  private[dsh] def appendRows(b: Binding, payloads: List[Json]): Vector[EventRow] =
    river.append(b.sessionId, b.liveRunId, payloads) match
      case seqs if seqs.size == payloads.size =>
        (b.rows ++ payloads.zip(seqs).map((p, seq) => EventRow(seq, dshRowJson(p)))).takeRight(bufferCap)
      case _ => b.rows

  private[dsh] def writeNdjson(sessionId: String, payload: Json): Unit =
    lock.synchronized:
      bindings.get(sessionId).foreach: b =>
        bindings = bindings.updated(sessionId, b.copy(rows = appendRows(b, List(payload))))

  private[dsh] def writeGoal(sessionId: String, data: Json): Option[Json] =
    val payload = dshGoalPayload(sessionId, data)
    writeNdjson(sessionId, payload)
    if liveOf(sessionId).isEmpty then Some(payload) else None

  private[dsh] def writeUi(b: Binding, e: TaskUpdated): Binding =
    val row = EventRow(0L, Json.obj("payload" -> payloadJson(e)).noSpaces)
    b.copy(uiLive = b.uiLive.updated(e.taskId, row))

