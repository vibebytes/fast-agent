package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.AgentAttachProtocol.Command.{AnswerQuestionBatch, QuestionBatchAnswer}
import ai.fastllm.agent.channel.AgentAttachProtocol.Event.{
  ApprovalExpired,
  ApprovalRequested,
  ApprovalResolved,
  QuestionBatchIntent,
  QuestionBatchItem,
  QuestionBatchOption,
  QuestionBatchRequested,
  QuestionBatchResolved,
  RunCancelled,
  RunCompleted,
  RunCreated,
  RunFailed,
  RunStateChanged,
  CheckpointEvent,
  ChildTranscriptDelta,
  SubagentFinished,
  SubagentStarted,
  SubagentUpdated,
  TaskUpdated,
  ToolStarted
}
import ai.fastllm.agent.channel.{
  Admit,
  AgentAttachProtocol,
  AgentEvent,
  AgentLoop,
  Caps,
  ChannelMessageWindow,
  EventRow,
  EventRowAppender,
  IngressOffer,
  OrderedEventIngress,
  RouteResult,
  payloadJson
}
import ai.fastllm.agent.remote.Client
import io.circe.Json
import io.circe.syntax.*
import org.slf4j.LoggerFactory

import java.util.concurrent.{Executors, TimeUnit}

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}
import scala.util.control.NonFatal

final case class PendingApproval(approvalId: String, rpcId: String, childSid: String)
final case class PendingQuestion(rpcId: String, childSid: String, items: List[QuestionBatchItem])
final case class ChildWork(
    childSessionId: String,
    mode: String,
    label: String,
    activity: String,
    started: Boolean = false,
    turnOpen: Boolean = false,
    lastStartTime: Option[Long] = None,
    preview: String = "",
    lastPreviewEmitMs: Option[Long] = None,
    lastMuxEventMs: Option[Long] = None,
    catalogIdleSince: Option[Long] = None
)

final case class UnknownWork(
    frames: Vector[Json] = Vector.empty,
    uses: Vector[String => Unit] = Vector.empty,
    queuedAt: Long = 0L
)

final case class Binding(
    cwd: String,
    liveRunId: Option[String] = None,
    approvals: Map[String, PendingApproval] = Map.empty,
    questions: Map[String, PendingQuestion] = Map.empty,
    children: Map[String, ChildWork] = Map.empty,
    rows: Vector[EventRow] = Vector.empty,
    fold: DshFold = DshFold(),
    toolCallIds: Vector[String] = Vector.empty,
    toolArgs: Map[String, String] = Map.empty,
    ending: Option[Future[Unit]] = None,
    bound: Boolean = false,
    live: Map[String, EventRow] = Map.empty,
    uiLive: Map[String, EventRow] = Map.empty,
    imageLimit: ImageLimit = ImageLimit(),
    jobs: Set[String] = Set.empty,
    turns: Int = 0,
    lastEventMs: Long = 0L,
    liveSinceMs: Long = 0L,
    childHistory: Map[String, Json] = Map.empty,
    wantsChildren: Boolean = false,
    spawnWatchSince: Option[Long] = None,
    /** Owning session: the river addresses rows by session, not by binding. */
    sessionId: String = ""
)

private case class DshBatch(sessionId: String, events: List[AgentEvent])

/** In-process DSH conversation loop. Fast seq is assigned after OrderedEventIngress. */
class DshLoop(
    private[dsh] val remote: Client,
    private[dsh] val cwdOf: String => String,
    private[dsh] val onTitle: (String, String) => Unit = (_, _) => (),
    private[dsh] val onTurnBegin: (String, String) => Future[Unit] = (_, _) => Future.unit,
    private[dsh] val onTurnEnd: (String, String, Vector[String]) => Future[Unit] = (_, _, _) => Future.unit,
    private[dsh] val onChildOpen: String => Unit = _ => (),
    private[dsh] val onError: (String, String) => Unit = (_, _) => (),
    private[dsh] val onGoal: (String, String, String, String, String) => Unit = (_, _, _, _, _) => (),
    private[dsh] val nowMs: () => Long = () => System.currentTimeMillis(),
    private[dsh] val bufferCap: Int = 2048,
    private[dsh] val river: DshRiver = DshRiver.local(),
    private[dsh] val maxTurns: Option[Int] = None
)(using private[dsh] val dshExec: ExecutionContext) extends AgentLoop, DshSubmit, DshAsk, DshIngest, DshCatalog:
  private[dsh] lazy val log = LoggerFactory.getLogger(getClass)
  private[dsh] val lock = new AnyRef
  private[dsh] var bindings = Map.empty[String, Binding]
  private[dsh] var childToParent = Map.empty[String, String]
  private[dsh] var missUntil = Map.empty[String, Long]
  private[dsh] var listing = Set.empty[String]
  private[dsh] var listAgain = Set.empty[String]
  private[dsh] var unknown = Map.empty[String, UnknownWork]
  private[dsh] var listTick = 0L
  private[dsh] var listBegan = Map.empty[String, Long]
  private[dsh] var listFresh = Map.empty[String, Long]
  private[dsh] val ingress = OrderedEventIngress[DshBatch](DshRows(), nowMs)

  private[dsh] val SweepPeriodMs = 10000L
  private[dsh] val SpawnWatchMs = 60000L
  private[dsh] lazy val sweepTimer =
    val ex = Executors.newSingleThreadScheduledExecutor: r =>
      val t = new Thread(r, "dsh-subagent-sweep")
      t.setDaemon(true)
      t
    ex.scheduleWithFixedDelay(() => runSweep(), SweepPeriodMs, SweepPeriodMs, TimeUnit.MILLISECONDS)
    ex

  private[dsh] def ensureSweep(): Unit = sweepTimer

  private def runSweep(): Unit =
    try sweepOpenChildren()
    catch case NonFatal(e) => log.debug(s"dsh subagent sweep: ${e.getMessage}")

  remote.listen("mux"): json =>
    muxOf(json).foreach:
      case Mux.Event(sessionId, event)        => routeEvent(sessionId, event)
      case Mux.Subscribed(sessionId, lastSeq) => onSubscribed(sessionId, lastSeq)
      case asked: Mux.ApprovalAsked           => onAsked(asked)
      case done: Mux.ApprovalDone             => onDone(done)
      case asked: Mux.QuestionAsked           => onQuestionAsked(asked)
      case done: Mux.QuestionDone             => onQuestionDone(done)
      case Mux.Queue(sessionId, items)        => onQueue(sessionId, items)
      case Mux.Jobs(sessionId, jobs)          => onJobs(sessionId, jobs)
      case Mux.Projection(sessionId, key, value) => onProjection(sessionId, key, value)
      case Mux.Failed(msg)                    => System.err.println(s"dsh mux: $msg")

  remote.listen("host"): json =>
    json.hcursor.get[String]("type").toOption match
      case Some("host/agent-error") =>
        val sid = json.hcursor.get[String]("sessionId").toOption.getOrElse("")
        val msg = json.hcursor.get[String]("message").toOption.getOrElse("host/agent-error")
        if sid.nonEmpty then onHostError(sid, msg)
      case _ => ()

  val caps: Caps = Caps(
    cancel = true,
    approval = true,
    answerQuestion = false,
    restore = true,
    steer = true,
    queue = true,
    rerun = false,
    usage = true,
    childTranscript = true,
    goalDelta = true,
    contextPrune = true
  )

  override def busy(sessionId: String): Boolean =
    snapshot(sessionId).exists: b =>
      val live = b.liveRunId.isDefined || b.approvals.nonEmpty || b.questions.nonEmpty || b.ending.exists(!_.isCompleted)
      if live && b.liveRunId.isDefined then warnIfStuck(sessionId, b)
      live

  private var stuckWarn = Map.empty[String, Long]

  /** Live run with no mux traffic for two minutes. The usual cause is a lost
    * follow stream, so the host keeps waiting for a turn/end that never comes.
    * Log only — cancelling here would kill legitimate long-running tools. */
  private def warnIfStuck(sessionId: String, b: Binding): Unit =
    val now = nowMs()
    val anchor = math.max(b.lastEventMs, b.liveSinceMs)
    if anchor > 0 && now - anchor > 120000L then
      val last = lock.synchronized(stuckWarn.getOrElse(sessionId, 0L))
      if now - last > 120000L then
        lock.synchronized:
          stuckWarn = stuckWarn.updated(sessionId, now)
        log.warn(s"dsh run stuck sid=$sessionId run=${b.liveRunId.getOrElse("")} idleMs=${now - anchor} rows=${b.rows.size}")

  override def childOpen(sessionId: String): Boolean =
    snapshot(sessionId).exists: b =>
      b.children.values.exists(_.activity == "running") ||
        b.approvals.values.exists(_.childSid != sessionId) ||
        b.questions.values.exists(_.childSid != sessionId)

  override def liveRun(sessionId: String): Option[String] = liveOf(sessionId)

  /** Diagnostic string of pending children/approvals/questions for tests and support. */
  def bindingDebug(sessionId: String): String =
    lock.synchronized(bindings.get(sessionId)).map: b =>
      s"children=${b.children.map((k, v) => s"$k=${v.activity}").mkString("[", ",", "]")}" +
        s" approvals=${b.approvals.map((k, v) => s"$k=${v.childSid}").mkString("[", ",", "]")}" +
        s" questions=${b.questions.map((k, v) => s"$k=${v.childSid}").mkString("[", ",", "]")}"
    .getOrElse("none")

  def cancel(cmd: AgentAttachProtocol.Command.CancelRun): Future[Admit] =
    liveOf(cmd.sessionId) match
      case Some(live) if live == cmd.runId =>
        remote.call("session.cancel", Json.obj("sessionId" -> cmd.sessionId.asJson)).map: json =>
          valueOf(json) match
            case Right(_) =>
              appendTerminal(cmd.sessionId, live, "cancelled")
              Admit.Accepted(live)
            case Left(e) => Admit.Rejected(e)
      case _ =>
        Future.successful(Admit.Rejected("no live run"))

  override def steer(cmd: AgentAttachProtocol.Command.SteerRun): Future[Admit] =
    if imageOverLimit(cmd.images, snapshot(cmd.sessionId).map(_.imageLimit).getOrElse(ImageLimit())) then
      Future.successful(Admit.Rejected("imageLimits"))
    else
      liveOf(cmd.sessionId) match
        case Some(live) =>
          prompt(cmd.sessionId, "steer", cmd.text, cmd.images, java.util.UUID.randomUUID().toString).map:
            case Right(_) => Admit.Steered(live)
            case Left(e)  => Admit.Rejected(e)
        case None => Future.successful(Admit.Rejected("no live run"))

  override def queue(cmd: AgentAttachProtocol.Command.QueueMessage): Future[Admit] =
    if !caps.queue then Future.successful(Admit.Rejected("queue disabled"))
    else
      val action = cmd.action.trim.toLowerCase match
        case "remove" => Json.obj("kind" -> "remove".asJson)
        case "steer"  => Json.obj("kind" -> "steer".asJson)
        case "edit" =>
          Json.obj(
            "kind" -> "edit".asJson,
            "content" -> Json.arr(Json.obj("type" -> "text".asJson, "text" -> cmd.text.getOrElse("").asJson))
          )
        case other => Json.obj("kind" -> other.asJson)
      remote.call(
        "session.updateQueue",
        Json.obj("sessionId" -> cmd.sessionId.asJson, "itemId" -> cmd.itemId.asJson, "action" -> action)
      ).map: json =>
        valueOf(json) match
          case Right(_) => Admit.Accepted(liveOf(cmd.sessionId).getOrElse(""))
          case Left(e)  => Admit.Rejected(e)

  def events(sessionId: String, afterSeq: Long): Future[List[EventRow]] =
    val (snaps, rows) =
      lock.synchronized:
        ingress.tick()
        val b = snapshot(sessionId)
        (
          b.map(x => x.live.values.toList ++ x.uiLive.values.toList).getOrElse(Nil),
          b.map(_.rows).getOrElse(Vector.empty)
        )
    // One clock: rows already carry the seq core assigned, so nothing here may renumber them.
    // A cursor from another engine (CommandLoop persistCursor after SetEngine) sits above the
    // river, so the river adopts it once instead of dropping the rows as already-applied.
    if afterSeq == Long.MaxValue then Future.successful(snaps)
    else if rows.nonEmpty && afterSeq > rows.last.seq then
      val adopted = rows.zipWithIndex.map((r, i) => r.copy(seq = afterSeq + 1 + i)).toList
      river.adopt(sessionId, afterSeq)
      lock.synchronized:
        bindings.get(sessionId).foreach(b => bindings = bindings.updated(sessionId, b.copy(rows = adopted.toVector)))
      Future.successful(snaps ++ adopted)
    else if rows.isEmpty then
      // Cold tail (a fresh engine process knows nothing): the river is the source of history.
      river.read(sessionId, afterSeq).map(snaps ++ _)
    else if afterSeq + 1 < rows.head.seq then
      // Cursor below the tail floor: the tail dropped those rows, the river kept them. Serve what
      // the river still has, and only claim a gap for what nothing can serve.
      river.read(sessionId, afterSeq).map: older =>
        val served = (rows.toList ++ older).groupBy(_.seq).values.map(_.head).toList.sortBy(_.seq)
        val gap =
          if afterSeq > 0 && served.headOption.exists(_.seq > afterSeq + 1) then
            List(dshGap(served.head.seq, served.last.seq))
          else Nil
        snaps ++ gap ++ served
    else
      // Steady state: the tail answers alone, no river round trip.
      Future.successful(snaps ++ rows.filter(_.seq > afterSeq).toList)

  /** Idempotent `session.create({ cwd, sessionId })`. Kind switch and DshCall bind here. */
  def bind(sessionId: String, cwd: String): Future[Either[Json, Unit]] = ensure(sessionId, cwd)

  /** First submit: `session.create({ cwd, sessionId })`. Same Fast id, same cwd is idempotent. */
  private[dsh] def ensure(sessionId: String, cwd: String, force: Boolean = false): Future[Either[Json, Unit]] =
    if !force && snapshot(sessionId).exists(_.bound) then Future.successful(Right(()))
    else
      remote.call(
        "session.create",
        Json.obj("cwd" -> cwd.asJson, "sessionId" -> sessionId.asJson)
      ).map: created =>
        created.hcursor.get[Boolean]("ok") match
          case Right(false) =>
            val code = created.hcursor.downField("error").get[String]("code").toOption.getOrElse("error")
            // A fresh engine process reattaching to a still-running host finds the
            // session already bound there; the host answers session/conflict. That is
            // the reopen case, not a failure — stamp and continue to history/follow.
            if DshCode.isSessionConflict(code) then
              stamp(sessionId, cwd)
              Right(())
            else Left(created.hcursor.downField("error").focus.getOrElse(Json.obj("code" -> "error".asJson)))
          case Right(true) =>
            stamp(sessionId, cwd)
            Right(())
          case _ =>
            Left(Json.obj("code" -> "internal".asJson))

  private[dsh] def stamp(sessionId: String, cwd: String): Unit =
    lock.synchronized:
      val prev = bindings.getOrElse(sessionId, Binding(cwd, sessionId = sessionId))
      bindings = bindings.updated(
        sessionId,
        putLive(prev.copy(bound = true, cwd = cwd), dshCapsRow(sessionId, queue = caps.queue, goal = true, budget = false, rerun = caps.rerun))
      )
    kickLists()

  private[dsh] def putLive(b: Binding, row: EventRow): Binding =
    val typ =
      io.circe.parser.parse(row.envelopeJson).toOption
        .flatMap(_.hcursor.downField("payload").get[String]("type").toOption)
        .getOrElse("")
    b.copy(live = b.live.updated(typ, row))

  private def onQueue(sessionId: String, items: Json): Unit =
    resolveHost(sessionId): parent =>
      lock.synchronized:
        bindings.get(parent).foreach: b =>
          bindings = bindings.updated(parent, putLive(b, dshQueueRow(parent, dshQueueItems(items))))

  private def onJobs(sessionId: String, jobs: Json): Unit =
    resolveHost(sessionId): parent =>
      lock.synchronized:
        bindings.get(parent).foreach: b =>
          val arr = jobs.asArray.getOrElse(Vector.empty)
          val seen = arr.flatMap(j => j.hcursor.get[String]("id").toOption.map(_.trim).filter(_.nonEmpty)).toSet
          val evs = arr.flatMap: j =>
            val c = j.hcursor
            for
              id <- c.get[String]("id").toOption.map(_.trim).filter(_.nonEmpty)
              kind <- c.get[String]("kind").toOption
            yield
              val label = c.get[String]("label").toOption.getOrElse(kind)
              val status = dshJobStatus(c.get[String]("status").toOption.getOrElse("running"))
              val detail = c.get[String]("detail").toOption
              TaskUpdated(parent, id, kind, status, title = label, detail = detail)
          val gone = (b.jobs -- seen).toList.map: id =>
            TaskUpdated(parent, id, "job", "done", title = id, detail = None)
          val next = (evs.toList ++ gone).foldLeft(b.copy(jobs = seen))(writeUi)
          bindings = bindings.updated(parent, next)

  private def onProjection(sessionId: String, key: String, value: Json): Unit =
    if key == "imageLimits" then
      resolveHost(sessionId): parent =>
        lock.synchronized:
          bindings.get(parent).foreach: b =>
            bindings = bindings.updated(parent, b.copy(imageLimit = imageLimitOf(value)))

  private def onHostError(sessionId: String, message: String): Unit =
    resolveHost(sessionId): parent =>
      writeNdjson(
        parent,
        Json.obj("type" -> "error".asJson, "message" -> message.asJson, "sessionId" -> parent.asJson)
      )
      if liveOf(parent).isEmpty then onError(parent, message)

  private class DshRows extends EventRowAppender[DshBatch]:
    def append(batch: DshBatch): Either[String, EventRow] =
      bindings.get(batch.sessionId) match
        case None => Left("no binding")
        case Some(b) =>
          val next = writeInto(b, batch.events)
          bindings = bindings.updated(batch.sessionId, next)
          next.rows.lastOption
            .orElse(next.uiLive.values.headOption)
            .toRight("empty")

  private[dsh] def snapshot(sessionId: String): Option[Binding] =
    lock.synchronized(bindings.get(sessionId))

  private[dsh] def liveOf(sessionId: String): Option[String] =
    snapshot(sessionId).flatMap(_.liveRunId)

  private[dsh] def setLive(sessionId: String, runId: Option[String]): Unit =
    lock.synchronized:
      bindings.get(sessionId).foreach: b =>
        bindings = bindings.updated(sessionId, b.copy(liveRunId = runId))

  private[dsh] def whenReady(f: Future[Json])(use: Try[Json] => Unit): Unit =
    f.value match
      case Some(t) => use(t)
      case None    => f.onComplete(use)

/** SessionEventStream settles only on RunCompleted / RunCancelled / RunFailed. */
private def riverOf(events: List[AgentEvent], live: Option[String]): List[AgentEvent] =
  events.flatMap:
    case e: RunCreated if e.agentId == "dsh" => Nil
    case e @ RunStateChanged(sid, rid, status, _, used) if live.contains(rid) =>
      val term = status match
        case "cancelled"        => RunCancelled(sid, rid, "dsh")
        case "failed" | "error" => RunFailed(sid, rid, "dsh")
        case _                  => RunCompleted(sid, rid)
      if used.isDefined then List(e, term) else List(term)
    case e => List(e)

private def valueOf(json: Json): Either[String, Json] =
  json.hcursor.get[Boolean]("ok") match
    case Right(false) =>
      Left(json.hcursor.downField("error").get[String]("code").toOption.getOrElse("error"))
    case _ =>
      Right(json.hcursor.downField("value").focus.getOrElse(json))

/** Host error codes. */
object DshCode:
  /** The session is not bound in this host process, e.g. a fresh engine after a restart. */
  val SessionNotFound = "session/not-found"
  /** Older hosts report the same condition with the dash spelling. */
  val SessionNotFoundDash = "session-not-found"

  def isSessionNotFound(code: String): Boolean =
    code == SessionNotFound || code == SessionNotFoundDash

  /** The session is already bound in the host process — a reopen, not an error. */
  val SessionConflict = "session/conflict"
  /** Older hosts report the same condition with the dash spelling. */
  val SessionConflictDash = "session-conflict"

  def isSessionConflict(code: String): Boolean =
    code == SessionConflict || code == SessionConflictDash

def dshSourceKind(raw: Json): Option[String] =
  raw.hcursor.downField("data").downField("source").get[String]("kind").toOption
    .orElse(dshSpliceSource(raw, "kind"))

/** DSH `data.source.form` → UI form; falls back to a kind-derived default. */
def dshSourceForm(raw: Json): String =
  raw.hcursor.downField("data").downField("source").get[String]("form").toOption
    .orElse(dshSpliceSource(raw, "form"))
    .map(_.trim).filter(_.nonEmpty)
    .getOrElse(dshSourceLabel(dshSourceKind(raw).getOrElse("")) match
      case "Recall" => "recall"
      case _        => "inject")

/** Short UI title for a synthetic context source kind. */
def dshSourceLabel(kind: String): String =
  kind.trim.toLowerCase match
    case "plugin"            => "Runtime context"
    case "recall"            => "Recall"
    case "subagent-settled"  => "Subagent settled"
    case "compaction"        => "Compaction"
    case other               => if other.isEmpty then "Context" else other

def dshSpliceSource(raw: Json, field: String): Option[String] =
  raw.hcursor.downField("data").downField("inserted").values
    .flatMap(_.view.map(_.hcursor.downField("source").get[String](field).toOption).find(_.isDefined))
    .flatten.map(_.trim).filter(_.nonEmpty)

/** Child session id carried by a subagent event. */
def dshChildSessionId(raw: Json): Option[String] =
  val c = raw.hcursor.downField("data")
  c.get[String]("sessionId").toOption.filter(_.nonEmpty)
    .orElse(c.get[String]("childSessionId").toOption.filter(_.nonEmpty))
    .map(_.trim)

def dshSenderSessionId(raw: Json): Option[String] =
  raw.hcursor.downField("data").downField("source").get[String]("senderSessionId").toOption
    .orElse(dshSpliceSource(raw, "senderSessionId"))
    .map(_.trim)
    .filter(_.nonEmpty)

def dshEventTime(raw: Json): Option[Long] =
  raw.hcursor.get[Long]("time").toOption

def dshSettled(raw: Json): Boolean =
  dshSourceKind(raw).contains("subagent-settled") && raw.hcursor
    .get[String]("type")
    .toOption
    .exists(t => t == "user/message" || t == "agent/inbox/spliced")

/** Parent settled notice is older than the child's latest mux turn/start. */
def dshSettledStale(settledAt: Option[Long], lastStart: Option[Long]): Boolean =
  lastStart.exists(start => settledAt.exists(_ < start))

def dshGap(bufferFloor: Long, bufferHigh: Long): EventRow =
  EventRow(
    0L,
    Json.obj(
      "payload" -> Json.obj(
        "type" -> Json.fromString("gap"),
        "floor" -> Json.fromLong(bufferFloor),
        "high" -> Json.fromLong(bufferHigh)
      )
    ).noSpaces
  )

