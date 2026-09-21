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

/** Belong to [[DshLoop]]. Parent/child mux event ingest. */
trait DshIngest:
  this: DshLoop =>
  private given ExecutionContext = dshExec

  private[dsh] def fill(sessionId: String, lastSeq: Long): Unit =
    if childToParent.contains(sessionId) then ()
    else
      val seen = ingress.committed(sessionId, sessionId)
      if lastSeq <= seen then ()
      else
        whenReady(remote.call("session.history", Json.obj("sessionId" -> sessionId.asJson))):
          case Success(json) =>
            valueOf(json).toOption.foreach: value =>
              historyEvents(value).foreach(onParentEvent(sessionId, _))
          case Failure(e) =>
            log.warn(s"dsh session.history: ${e.getMessage}", e)

  private[dsh] def onSubscribed(sessionId: String, lastSeq: Long): Unit =
    lock.synchronized(hostOf(sessionId)) match
      case Some(parent) if parent == sessionId =>
        fill(sessionId, lastSeq)
        refreshCatalog(sessionId)
      case Some(_) => ()
      case None    => discover(sessionId, None)

  private[dsh] def routeEvent(sessionId: String, event: Json): Unit =
    lock.synchronized(hostOf(sessionId)) match
      case Some(parent) if parent == sessionId =>
        onParentEvent(sessionId, event)
        maybeRefreshOnTool(sessionId, event)
      case Some(parent) =>
        onChildEvent(parent, sessionId, event)
      case None =>
        discover(sessionId, Some(event))

  private[dsh] def maybeRefreshOnTool(sessionId: String, event: Json): Unit =
    val raw = event.hcursor.downField("payload").downField("event").focus.getOrElse(event)
    raw.hcursor.get[String]("type").toOption match
      case Some("tool/call") =>
        val name = raw.hcursor.downField("data").get[String]("name").toOption.getOrElse("")
        if name == "subagent" || name == "subagent_fork" then
          markSpawnWatch(sessionId)
          refreshCatalog(sessionId)
      // The child session is created asynchronously, so the tool/call refresh above
      // usually runs before subagent.list can see it. A subagent/* event carries the
      // real child id, so re-listing here is the first moment the child is watchable.
      // Without this the child is never followed, its turn/end never reaches the mux,
      // and childOpen stays true forever.
      case Some(t) if t.startsWith("subagent/") =>
        if dshChildSessionId(raw).isDefined then
          markSpawnWatch(sessionId)
          refreshCatalog(sessionId)
      case _ => ()

  private[dsh] def onParentEvent(sessionId: String, event: Json): Unit =
    val raw = event.hcursor.downField("payload").downField("event").focus.getOrElse(event)
    val dshSeq = raw.hcursor.get[Long]("seq").toOption
    val t = raw.hcursor.get[String]("type").toOption.getOrElse("")
    var idleGoal: Option[Json] = None
    val (titled, ended) = lock.synchronized:
      ingress.tick()
      bindings.get(sessionId) match
        case None => (None, None)
        case Some(b0) =>
          val live = b0.liveRunId
          val idleOk =
            t == "session/title" || t == "compaction/start" || t == "compaction/summary" || t == "compaction/end" ||
              t == "goal/change" || t.startsWith("subagent/")
          if dshSettled(raw) then
            dshSenderSessionId(raw) match
              case Some(sender) => idleSettled(sessionId, sender, dshEventTime(raw))
              case None =>
                log.warn(s"dsh subagent-settled notice without sender: sid=$sessionId seq=${dshSeq.getOrElse(-1L)}")
            dshSeq.foreach(s => ingress.consume(sessionId, sessionId, s))
            (None, None)
          else if live.isEmpty && !idleOk && t != "turn/start" then
            if t == "agent/inbox/spliced" then refreshCatalog(sessionId)
            dshSeq.foreach(s => ingress.consume(sessionId, sessionId, s))
            (None, None)
          else
            // A turn/start with no claimed run means this process attached mid-turn
            // (engine restart / reopen). Adopt the run so the rest of the turn is not
            // dropped by the live.isEmpty gate above.
            val adopted =
              if live.isEmpty && t == "turn/start" then
                val rid = dshAdoptedRunId(sessionId, raw)
                bindings = bindings.updated(
                  sessionId,
                  b0.copy(liveRunId = Some(rid), liveSinceMs = nowMs(), lastEventMs = nowMs())
                )
                Some(rid)
              else None
            val runId = adopted.orElse(live).getOrElse("")
            val step = dshEvents(sessionId, runId, raw, b0.fold)
            val river = riverOf(step.events, adopted.orElse(live))
            val unitId = turnStep(raw.hcursor.downField("data").focus.getOrElse(Json.obj()))
              .map((turn, stepNo) => s"$turn:$stepNo")
            val isCkpt = river.exists:
              case _: CheckpointEvent => true
              case _                  => false
            if t == "turn/start" then maybeBudgetCancel(sessionId)
            if t == "goal/change" then
              idleGoal = writeGoal(sessionId, raw.hcursor.downField("data").focus.getOrElse(Json.obj()))
            if river.isEmpty then dshSeq.foreach(s => ingress.consume(sessionId, sessionId, s))
            else
              dshSeq.foreach: s =>
                if ingress.committed(sessionId, sessionId) == 0 && s > 1 then
                  ingress.consume(sessionId, sessionId, s - 1)
              ingress.offer(
                IngressOffer(sessionId, sessionId, dshSeq, unitId, isCkpt, DshBatch(sessionId, river))
              )
            bindings.get(sessionId).foreach: cur =>
              bindings = bindings.updated(sessionId, cur.copy(fold = step.fold))
            val after = bindings.get(sessionId)
            val endedRun =
              b0.liveRunId.filter: rid =>
                after.exists(_.liveRunId.isEmpty) && river.exists:
                  case RunStateChanged(_, id, _, _, _) if id == rid => true
                  case RunCompleted(_, id, _) if id == rid => true
                  case RunCancelled(_, id, _, _) if id == rid => true
                  case RunFailed(_, id, _, _, _) if id == rid => true
                  case _ => false
            (step.title.filter(_.nonEmpty), endedRun)
    titled.foreach(title => onTitle(sessionId, title))
    ended.foreach(rid => settle(sessionId, rid))
    idleGoal.foreach: payload =>
      val c = payload.hcursor
      onGoal(
        sessionId,
        c.get[String]("operation").toOption.getOrElse(""),
        c.get[String]("phase").toOption.getOrElse(""),
        c.get[String]("title").toOption.getOrElse(""),
        c.get[String]("text").toOption.getOrElse("")
      )

  /** Run id for a turn/start that arrived without a claimed run. Derived from the
    * turn number so a replayed turn/start maps to the same id instead of churning. */
  private[dsh] def dshAdoptedRunId(sessionId: String, raw: Json): String =
    val turn = raw.hcursor.downField("data").get[Int]("turn").toOption.getOrElse(0)
    s"$sessionId:$turn"

  private[dsh] def maybeBudgetCancel(sessionId: String): Unit =
    lock.synchronized:
      bindings.get(sessionId).foreach: b =>
        val n = b.turns + 1
        bindings = bindings.updated(sessionId, b.copy(turns = n))
        if maxTurns.exists(n >= _) then
          remote.call("session.cancel", Json.obj("sessionId" -> sessionId.asJson))
          ()

  private[dsh] def idleSettled(parent: String, childSid: String, settledAt: Option[Long]): Unit =
    snapshot(parent).flatMap(_.children.get(childSid)) match
      case Some(c) if c.activity == "running" && !dshSettledStale(settledAt, c.lastStartTime) =>
        log.info(
          s"dsh idle settled running child: parent=$parent child=$childSid settledAt=${settledAt.getOrElse(-1L)} " +
            s"lastMuxEventMs=${c.lastMuxEventMs.getOrElse(-1L)} turnOpen=${c.turnOpen}"
        )
        writeChildPreview(parent, childSid, activity = Some("inactive"))
      case _ => ()

  private[dsh] def childMeta(parent: String, childSid: String): (String, String) =
    snapshot(parent).flatMap(_.children.get(childSid)).map(c => (c.mode, c.label)).getOrElse(("one-shot", ""))

  private[dsh] def onChildEvent(parent: String, childSid: String, event: Json, replaySeq: Option[Long] = None): Unit =
    val raw = event.hcursor.downField("payload").downField("event").focus
      .orElse(event.hcursor.downField("event").focus)
      .getOrElse(event)
    val t = raw.hcursor.get[String]("type").toOption.getOrElse("")
    val data = raw.hcursor.downField("data").focus.getOrElse(Json.obj())
    t match
      case "turn/start" =>
        val (mode, label) = childMeta(parent, childSid)
        ensureStarted(parent, childSid, mode, label)
        writeChildPreview(parent, childSid, activity = Some("running"), preview = Some(""))
        markTurnStart(parent, childSid, dshEventTime(raw))
        maybeNotifyOpen(parent)
      case "turn/end" =>
        val kind = data.hcursor.downField("reason").get[String]("kind").toOption.getOrElse("completed")
        val finished =
          if childMeta(parent, childSid)._1 == "one-shot" then
            List(SubagentFinished(parent, childSid, dshEndStatus(kind)))
          else Nil
        writeChildPreview(parent, childSid, activity = Some("inactive"), extra = finished)
      case _ =>
        emitChildDelta(parent, raw, replaySeq)
        dshPreviewDelta(data, t) match
          case Some(delta) => writeChildPreview(parent, childSid, append = Some(delta -> t))
          case None        => stampMuxEvent(parent, childSid)

  private[dsh] def stampMuxEvent(parent: String, childSid: String): Unit =
    val now = nowMs()
    lock.synchronized:
      bindings.get(parent).foreach: b =>
        b.children.get(childSid).foreach: c =>
          bindings = bindings.updated(
            parent,
            b.copy(children = b.children.updated(childSid, c.copy(lastMuxEventMs = Some(now))))
          )

  private[dsh] def emitChildDelta(parent: String, raw: Json, replaySeq: Option[Long] = None): Unit =
    val step = lock.synchronized:
      bindings.get(parent).map: b =>
        val s = dshEvents(parent, b.liveRunId.getOrElse(""), raw, b.fold)
        val deltas = s.events.collect { case d: ChildTranscriptDelta => d }
        bindings = bindings.updated(parent, b.copy(fold = replayedFold(b.fold, deltas, replaySeq)))
        s
    step.foreach: s =>
      val deltas = s.events.collect { case d: ChildTranscriptDelta => d }.map: d =>
        replaySeq.fold(d)(n => d.copy(childSeq = n))
      if deltas.nonEmpty then
        ingress.offer(IngressOffer(parent, parent, None, None, false, DshBatch(parent, deltas)))

  private[dsh] def replayedFold(fold: DshFold, deltas: List[ChildTranscriptDelta], replaySeq: Option[Long]): DshFold =
    replaySeq match
      case None => fold
      case Some(n) =>
        deltas.map(_.childSessionId).distinct.foldLeft(fold): (f, id) =>
          f.copy(childSeq = f.childSeq.updated(id, f.childSeq.getOrElse(id, 0L).max(n)))

  private[dsh] def writeChildPreview(
      parent: String,
      childSid: String,
      activity: Option[String] = None,
      preview: Option[String] = None,
      append: Option[(String, String)] = None,
      extra: List[AgentEvent] = Nil
  ): Unit =
    lock.synchronized:
      val now = nowMs()
      bindings.get(parent).foreach: b =>
        b.children.get(childSid).foreach: c =>
          val nextPreview =
            preview.getOrElse:
              append.fold(c.preview): (delta, tpe) =>
                clipPreview(joinPreview(c.preview, delta, tpe))
          val nextActivity = activity.getOrElse(c.activity)
          val nextTurnOpen =
            activity match
              case Some("running") => true
              case Some(_)         => false
              case None            => c.turnOpen
          previewEmit(activity.isDefined, c.lastPreviewEmitMs, now) match
            case PreviewEmit.Hold =>
              bindings = bindings.updated(
                parent,
                b.copy(children = b.children.updated(childSid, c.copy(preview = nextPreview, lastMuxEventMs = Some(now))))
              )
            case _ =>
              val next = c.copy(
                activity = nextActivity,
                turnOpen = nextTurnOpen,
                preview = nextPreview,
                lastPreviewEmitMs = Some(now),
                lastMuxEventMs = Some(now),
                catalogIdleSince = if nextActivity == "running" then None else c.catalogIdleSince
              )
              bindings = bindings.updated(
                parent,
                rowsOf(
                  b.copy(children = b.children.updated(childSid, next)),
                  SubagentUpdated(parent, childSid, nextActivity, Some(nextPreview)) :: extra
                )
              )

