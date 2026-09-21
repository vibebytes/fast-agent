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

/** Belong to [[DshLoop]]. Child catalog discover / list / activity. */
trait DshCatalog:
  this: DshLoop =>
  private given ExecutionContext = dshExec

  private[dsh] def hostOf(muxSid: String): Option[String] =
    if bindings.contains(muxSid) then Some(muxSid) else childToParent.get(muxSid)

  private[dsh] def resolveHost(muxSid: String)(use: String => Unit): Unit =
    lock.synchronized(hostOf(muxSid)) match
      case Some(parent) => use(parent)
      case None         => discover(muxSid, None, Some(use))

  private[dsh] def discover(unknownSid: String, frame: Option[Json], use: Option[String => Unit] = None): Unit =
    val now = nowMs()
    val start =
      lock.synchronized:
        if missUntil.get(unknownSid).exists(_ > now) then false
        else
          listTick += 1
          val prev = unknown.getOrElse(unknownSid, UnknownWork())
          unknown = unknown.updated(
            unknownSid,
            prev.copy(
              frames = prev.frames ++ frame.toVector,
              uses = prev.uses ++ use.toVector,
              queuedAt = listTick
            )
          )
          true
    if start then kickLists()

  private[dsh] def kickLists(): Unit =
    val pending =
      lock.synchronized:
        if unknown.isEmpty then Nil
        else
          val ids = bindings.keys.toList.filterNot(listing.contains)
          listing = listing ++ ids
          ids
    pending.foreach(listParent)

  private[dsh] def refreshCatalog(parent: String): Unit =
    val skip =
      lock.synchronized:
        if listing.contains(parent) then
          listAgain = listAgain + parent
          true
        else
          listing = listing + parent
          false
    if !skip then listParent(parent)

  private[dsh] def listParent(parent: String): Unit =
    lock.synchronized:
      listTick += 1
      listBegan = listBegan.updated(parent, listTick)
    whenReady(remote.call("subagent.list", Json.obj("parentSessionId" -> parent.asJson))):
      case Success(json) =>
        afterList(parent, ingestCatalog(parent, json))
      case Failure(e) =>
        log.warn(s"dsh subagent.list: ${e.getMessage}", e)
        afterList(parent, ok = false)

  private[dsh] def afterList(parent: String, ok: Boolean): Unit =
    val (replay, relist, again) = lock.synchronized:
      listing = listing - parent
      val began = listBegan.getOrElse(parent, 0L)
      if ok then listFresh = listFresh.updated(parent, began)
      val runs = flushUnknown()
      val again = listAgain.contains(parent)
      listAgain = listAgain - parent
      if listing.isEmpty && ok then concludeMisses()
      (runs, unknown.nonEmpty && listing.isEmpty && ok, again)
    replay.foreach(_())
    if again then refreshCatalog(parent)
    if relist then kickLists()

  private[dsh] def flushUnknown(): List[() => Unit] =
    unknown.toList.flatMap: (sid, work) =>
      hostOf(sid) match
        case Some(parent) =>
          unknown = unknown - sid
          List: () =>
            work.frames.foreach(onChildEvent(parent, sid, _))
            work.uses.foreach(_(parent))
        case None => Nil

  private[dsh] def concludeMisses(): Unit =
    val now = nowMs()
    val parents = bindings.keys.toList
    if parents.isEmpty then ()
    else
      val (stale, fresh) = unknown.partition: (sid, work) =>
        hostOf(sid).isEmpty && parents.forall(p => listFresh.get(p).exists(_ >= work.queuedAt))
      stale.keys.foreach: sid =>
        missUntil = missUntil.updated(sid, now + 2000)
      unknown = fresh

  private[dsh] def sweepOpenChildren(): Unit =
    val now = nowMs()
    val parents =
      lock.synchronized:
        val open = bindings.filter: (sid, b) =>
          b.wantsChildren && (b.children.values.exists(_.activity == "running") ||
            b.spawnWatchSince.exists(now - _ < SpawnWatchMs))
        open.keys.toList
    parents.foreach(refreshCatalog)

  private[dsh] def markSpawnWatch(sessionId: String): Unit =
    val now = nowMs()
    lock.synchronized:
      bindings.get(sessionId).foreach: b =>
        bindings = bindings.updated(sessionId, b.copy(wantsChildren = true, spawnWatchSince = Some(now)))
    ensureSweep()

  private[dsh] def markCatalogIdle(parent: String, childSid: String, at: Long): Unit =
    lock.synchronized:
      bindings.get(parent).foreach: b =>
        b.children.get(childSid).foreach: c =>
          bindings = bindings.updated(
            parent,
            b.copy(children = b.children.updated(childSid, c.copy(catalogIdleSince = Some(at))))
          )

  private[dsh] def ingestCatalog(parent: String, json: Json): Boolean =
    valueOf(json) match
      case Left(err) =>
        log.warn(s"dsh subagent.list: $err")
        false
      case Right(value) =>
        value.hcursor.downField("entries").as[List[Json]].toOption.getOrElse(Nil).foreach: e =>
          e.hcursor.get[String]("kind").toOption match
            case Some("diagnostic") =>
              val id = e.hcursor.get[String]("id").toOption.getOrElse("")
              val reason = e.hcursor.get[String]("reason").toOption.getOrElse("")
              System.err.println(s"dsh catalog diagnostic id=$id reason=$reason")
            case Some("child") =>
              val id = e.hcursor.get[String]("id").toOption.getOrElse("")
              if id.nonEmpty then
                val mode = e.hcursor.get[String]("mode").toOption.getOrElse("one-shot")
                val label = e.hcursor.get[String]("label").toOption.getOrElse("")
                val activity = e.hcursor.get[String]("activity").toOption.getOrElse("inactive")
                val prev = snapshot(parent).flatMap(_.children.get(id))
                val first = prev.forall(!_.started)
                registerChild(parent, id, mode, label)
                ensureStarted(parent, id, mode, label)
                if activity == "running" then
                  setActivity(parent, id, "running", turnOpen = Option.unless(first)(true))
                  if !first && prev.exists(_.activity != "running") then
                    appendParent(parent, List(SubagentUpdated(parent, id, "running")))
                  maybeNotifyOpen(parent)
                else if first then
                  setActivity(parent, id, "inactive")
                  appendParent(parent, List(SubagentUpdated(parent, id, "inactive")))
                else if prev.exists(_.activity == "running") then
                  // A turn-open child settles only on a second idle read with no child mux
                  // traffic in between; one stale read must not clobber a live child.
                  snapshot(parent).flatMap(_.children.get(id)) match
                    case Some(c) if c.turnOpen =>
                      val now = nowMs()
                      c.catalogIdleSince match
                        case Some(marked) if c.lastMuxEventMs.forall(_ <= marked) =>
                          setActivity(parent, id, "inactive")
                          appendParent(parent, List(SubagentUpdated(parent, id, "inactive")))
                          log.info(
                            s"dsh catalog settled turn-open child after idle repeat: parent=$parent child=$id " +
                              s"lastMuxEventMs=${c.lastMuxEventMs.getOrElse(-1L)} idleSince=$marked"
                          )
                        case _ => markCatalogIdle(parent, id, now)
                    case _ =>
                      setActivity(parent, id, "inactive")
                      appendParent(parent, List(SubagentUpdated(parent, id, "inactive")))
            case _ => ()
        true

  private[dsh] def registerChild(parent: String, childSid: String, mode: String, label: String): Unit =
    lock.synchronized:
      childToParent = childToParent.updated(childSid, parent)
      missUntil = missUntil - childSid
      bindings.get(parent).foreach: b =>
        val prev = b.children.getOrElse(childSid, ChildWork(childSid, mode, label, "inactive"))
        val next = prev.copy(mode = mode, label = if label.nonEmpty then label else prev.label)
        bindings = bindings.updated(parent, b.copy(wantsChildren = true, children = b.children.updated(childSid, next)))
    ensureSweep()

  private[dsh] def ensureStarted(parent: String, childSid: String, mode: String, label: String): Unit =
    lock.synchronized:
      bindings.get(parent).foreach: b =>
        b.children.get(childSid) match
          case Some(c) if c.started => ()
          case other =>
            val runId = b.liveRunId.getOrElse("")
            val work = other.getOrElse(ChildWork(childSid, mode, label, "inactive"))
              .copy(started = true, mode = mode, label = if label.nonEmpty then label else other.map(_.label).getOrElse(label))
            bindings = bindings.updated(
              parent,
              rowsOf(b.copy(children = b.children.updated(childSid, work)), List(SubagentStarted(parent, runId, childSid, work.mode, work.label)))
            )

  private[dsh] def markTurnStart(parent: String, childSid: String, at: Option[Long]): Unit =
    at.foreach: t =>
      lock.synchronized:
        bindings.get(parent).foreach: b =>
          b.children.get(childSid).foreach: c =>
            bindings = bindings.updated(
              parent,
              b.copy(children = b.children.updated(childSid, c.copy(lastStartTime = Some(t))))
            )

  private[dsh] def setActivity(parent: String, childSid: String, activity: String, turnOpen: Option[Boolean] = None): Unit =
    val now = nowMs()
    lock.synchronized:
      bindings.get(parent).foreach: b =>
        b.children.get(childSid).foreach: c =>
          bindings = bindings.updated(
            parent,
            b.copy(
              children = b.children.updated(
                childSid,
                c.copy(
                  activity = activity,
                  turnOpen = turnOpen.getOrElse(c.turnOpen),
                  lastMuxEventMs = Some(now),
                  catalogIdleSince = if activity == "running" then None else c.catalogIdleSince
                )
              )
            )
          )

  private[dsh] def appendParent(parent: String, events: List[AgentEvent]): Unit =
    lock.synchronized:
      bindings.get(parent).foreach: b =>
        bindings = bindings.updated(parent, rowsOf(b, events))

  private[dsh] def maybeNotifyOpen(parent: String): Unit =
    if snapshot(parent).exists(_.liveRunId.isEmpty) && childOpen(parent) then onChildOpen(parent)

