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
    lastPreviewEmitMs: Option[Long] = None
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
    seq: Long = 0L,
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
    childHistory: Map[String, Json] = Map.empty
)

private case class DshBatch(sessionId: String, events: List[AgentEvent])

/** In-process DSH conversation loop. Fast seq is assigned after OrderedEventIngress. */
class DshLoop(
    remote: Client,
    cwdOf: String => String,
    onTitle: (String, String) => Unit = (_, _) => (),
    onTurnBegin: (String, String) => Future[Unit] = (_, _) => Future.unit,
    onTurnEnd: (String, String, Vector[String]) => Future[Unit] = (_, _, _) => Future.unit,
    onChildOpen: String => Unit = _ => (),
    onError: (String, String) => Unit = (_, _) => (),
    onGoal: (String, String, String, String, String) => Unit = (_, _, _, _, _) => (),
    nowMs: () => Long = () => System.currentTimeMillis(),
    bufferCap: Int = 2048,
    maxTurns: Option[Int] = None
)(using ExecutionContext) extends AgentLoop:
  private lazy val log = LoggerFactory.getLogger(getClass)
  private val lock = new AnyRef
  private var bindings = Map.empty[String, Binding]
  private var childToParent = Map.empty[String, String]
  private var missUntil = Map.empty[String, Long]
  private var listing = Set.empty[String]
  private var listAgain = Set.empty[String]
  private var unknown = Map.empty[String, UnknownWork]
  private var listTick = 0L
  private var listBegan = Map.empty[String, Long]
  private var listFresh = Map.empty[String, Long]
  private val ingress = OrderedEventIngress[DshBatch](DshRows(), nowMs)

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

  val caps: Caps = Caps(cancel = true, approval = true, question = false, restore = true)

  override def busy(sessionId: String): Boolean =
    snapshot(sessionId).exists: b =>
      b.liveRunId.isDefined || b.approvals.nonEmpty || b.questions.nonEmpty || b.ending.exists(!_.isCompleted)

  override def childOpen(sessionId: String): Boolean =
    snapshot(sessionId).exists: b =>
      b.children.values.exists(_.activity == "running") ||
        b.approvals.values.exists(_.childSid != sessionId) ||
        b.questions.values.exists(_.childSid != sessionId)

  override def liveRun(sessionId: String): Option[String] = liveOf(sessionId)

  def submit(cmd: AgentAttachProtocol.Command.SubmitUserMessage): Future[Admit] =
    if cmd.skillSlash.isDefined then Future.successful(Admit.Rejected("dsh_slash"))
    else
      val cwd = cwdOf(cmd.sessionId).trim
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
                  prompt(cmd.sessionId, "queue", cmd.text, cmd.images).map:
                    case Right(_) => Admit.Steered(live)
                    case Left(e)  => Admit.Rejected(e)
                case None =>
                  drain(cmd.sessionId).flatMap(_ => startTurn(cmd))

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

  def decide(cmd: AgentAttachProtocol.Command.DecideApproval): Future[RouteResult] =
    snapshot(cmd.sessionId).flatMap(_.approvals.get(cmd.approvalId)) match
      case None => Future.successful(RouteResult("rejected", "", "no pending approval"))
      case Some(p) =>
        val outcome = if cmd.approved then "allowed-once" else "rejected"
        val target = snapshot(cmd.sessionId).flatMap(_.liveRunId).getOrElse("")
        remote.reply(
          p.rpcId,
          Json.obj(
            "sessionId" -> p.childSid.asJson,
            "approvalId" -> cmd.approvalId.asJson,
            "outcome" -> outcome.asJson
          )
        ).map(_ => RouteResult("accepted", target, "")).recover:
          case NonFatal(e) =>
            RouteResult("rejected", "", Option(e.getMessage).filter(_.nonEmpty).getOrElse("respond"))

  override def answer(cmd: AnswerQuestionBatch): Future[RouteResult] =
    snapshot(cmd.sessionId).flatMap(_.questions.get(cmd.rpcId)) match
      case None => Future.successful(RouteResult("rejected", "", "no pending question"))
      case Some(p) =>
        val target = snapshot(cmd.sessionId).flatMap(_.liveRunId).getOrElse("")
        if cmd.cancelled then
          dropQuestion(cmd.sessionId, cmd.rpcId)
          remote.replyCancel(cmd.rpcId).map(_ => RouteResult("accepted", target, "")).recover:
            case NonFatal(e) =>
              RouteResult("rejected", "", Option(e.getMessage).filter(_.nonEmpty).getOrElse("respond"))
        else if !batchAnswersMatch(p.items, cmd.answers) then
          Future.successful(RouteResult("rejected", "", "bad-response"))
        else
          dropQuestion(cmd.sessionId, cmd.rpcId)
          remote.reply(cmd.rpcId, batchReply(p.childSid, cmd.answers)).map(_ => RouteResult("accepted", target, "")).recover:
            case NonFatal(e) =>
              RouteResult("rejected", "", Option(e.getMessage).filter(_.nonEmpty).getOrElse("respond"))

  override def steer(cmd: AgentAttachProtocol.Command.DshSteer): Future[Admit] =
    if imageOverLimit(cmd.images, snapshot(cmd.sessionId).map(_.imageLimit).getOrElse(ImageLimit())) then
      Future.successful(Admit.Rejected("imageLimits"))
    else
      liveOf(cmd.sessionId) match
        case Some(live) =>
          prompt(cmd.sessionId, "steer", cmd.text, cmd.images).map:
            case Right(_) => Admit.Steered(live)
            case Left(e)  => Admit.Rejected(e)
        case None => Future.successful(Admit.Rejected("no live run"))

  override def queue(cmd: AgentAttachProtocol.Command.DshQueue): Future[Admit] =
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
    Future.successful:
      lock.synchronized(ingress.tick())
      val b = snapshot(sessionId)
      val rows = b.map(_.rows).getOrElse(Vector.empty)
      val snaps = b.map(x => x.live.values.toList ++ x.uiLive.values.toList).getOrElse(Nil)
      val floor = rows.headOption.map(_.seq)
      if afterSeq > 0 && floor.exists(f => afterSeq < f - 1) then
        snaps ++ List(dshGap(floor.get, rows.last.seq))
      else snaps ++ rows.filter(_.seq > afterSeq).toList

  def restore(sessionId: String, beforeTurnId: Option[String], limit: Int): Future[ChannelMessageWindow] =
    val lim = if limit <= 0 then 20 else limit
    remote.ready.flatMap: _ =>
      remote.call(
        "session.history",
        Json.obj("sessionId" -> sessionId.asJson, "maxMessages" -> Json.fromInt((lim * 2).max(50)))
      )
    .flatMap: json =>
      valueOf(json) match
        case Left("session-not-found") =>
          Future.successful(ChannelMessageWindow(Nil, hasMoreOlder = false, totalExchangeCount = 0))
        case Left(err) =>
          System.err.println(s"dsh restore: $err")
          Future.failed(RuntimeException(err))
        case Right(value) =>
          val folded = dshHistory(sessionId, historyEvents(value))
          bindRestore(sessionId, folded.lastSeq)
          refreshCatalog(sessionId)
          folded.title.foreach(title => onTitle(sessionId, title))
          val hasMore = value.hcursor.get[Boolean]("hasMore").toOption.getOrElse(false)
          val page = dshWindow(folded.rows, beforeTurnId, lim)
          val out = page.copy(hasMoreOlder = page.hasMoreOlder || hasMore)
          fillChildHistory(sessionId).map(_ => out)

  /** Idempotent `session.create({ cwd, sessionId })`. Kind switch and DshCall bind here. */
  def bind(sessionId: String, cwd: String): Future[Either[Json, Unit]] = ensure(sessionId, cwd)

  /** First submit: `session.create({ cwd, sessionId })`. Same Fast id, same cwd is idempotent. */
  private def ensure(sessionId: String, cwd: String): Future[Either[Json, Unit]] =
    if snapshot(sessionId).exists(_.bound) then Future.successful(Right(()))
    else
      remote.call(
        "session.create",
        Json.obj("cwd" -> cwd.asJson, "sessionId" -> sessionId.asJson)
      ).map: created =>
        created.hcursor.get[Boolean]("ok") match
          case Right(false) =>
            Left(created.hcursor.downField("error").focus.getOrElse(Json.obj("code" -> "error".asJson)))
          case Right(true) =>
            stamp(sessionId, cwd)
            Right(())
          case _ =>
            Left(Json.obj("code" -> "internal".asJson))

  private def stamp(sessionId: String, cwd: String): Unit =
    lock.synchronized:
      val prev = bindings.getOrElse(sessionId, Binding(cwd))
      bindings = bindings.updated(
        sessionId,
        putLive(prev.copy(bound = true, cwd = cwd), dshCapsRow(sessionId, queue = true, goal = true, budget = false))
      )
    kickLists()

  private def putLive(b: Binding, row: EventRow): Binding =
    val typ =
      io.circe.parser.parse(row.envelopeJson).toOption
        .flatMap(_.hcursor.downField("payload").get[String]("type").toOption)
        .getOrElse("")
    b.copy(live = b.live.updated(typ, row))

  private def prompt(
      sessionId: String,
      mode: String,
      text: String,
      images: List[AgentAttachProtocol.SubmitImage] = Nil
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
        "content" -> Json.fromValues(parts)
      )
    ).map(json => valueOf(json).map(_ => ()))

  private def fill(sessionId: String, lastSeq: Long): Unit =
    if childToParent.contains(sessionId) then ()
    else
      val seen = ingress.committed(sessionId, sessionId)
      if lastSeq <= seen then ()
      else
        whenReady(remote.call("session.history", Json.obj("sessionId" -> sessionId.asJson))):
          case Success(json) =>
            valueOf(json).toOption.foreach: value =>
              value.hcursor.downField("events").as[List[Json]].toOption.getOrElse(Nil).foreach: item =>
                item.hcursor.downField("event").focus.foreach(onParentEvent(sessionId, _))
          case Failure(e) =>
            log.warn(s"dsh session.history: ${e.getMessage}", e)

  private def onSubscribed(sessionId: String, lastSeq: Long): Unit =
    lock.synchronized(hostOf(sessionId)) match
      case Some(parent) if parent == sessionId =>
        fill(sessionId, lastSeq)
        refreshCatalog(sessionId)
      case Some(_) => ()
      case None    => discover(sessionId, None)

  private def routeEvent(sessionId: String, event: Json): Unit =
    lock.synchronized(hostOf(sessionId)) match
      case Some(parent) if parent == sessionId =>
        onParentEvent(sessionId, event)
        maybeRefreshOnTool(sessionId, event)
      case Some(parent) =>
        onChildEvent(parent, sessionId, event)
      case None =>
        discover(sessionId, Some(event))

  private def maybeRefreshOnTool(sessionId: String, event: Json): Unit =
    val raw = event.hcursor.downField("payload").downField("event").focus.getOrElse(event)
    if raw.hcursor.get[String]("type").toOption.contains("tool/call") then
      val name = raw.hcursor.downField("data").get[String]("name").toOption.getOrElse("")
      if name == "subagent" || name == "subagent_fork" then refreshCatalog(sessionId)

  private def onParentEvent(sessionId: String, event: Json): Unit =
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
              t == "goal/change"
          if dshSettled(raw) then
            dshSenderSessionId(raw).foreach(idleSettled(sessionId, _, dshEventTime(raw)))
            dshSeq.foreach(s => ingress.consume(sessionId, sessionId, s))
            (None, None)
          else if live.isEmpty && !idleOk then
            dshSeq.foreach(s => ingress.consume(sessionId, sessionId, s))
            (None, None)
          else
            val runId = live.getOrElse("")
            val step = dshEvents(sessionId, runId, raw, b0.fold)
            val river = riverOf(step.events, live)
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

  private def appendTerminal(sessionId: String, runId: String, status: String): Unit =
    lock.synchronized:
      offerSerial(sessionId, riverOf(List(RunStateChanged(sessionId, runId, status)), Some(runId)))
    settle(sessionId, runId)

  private def settle(sessionId: String, runId: String): Unit =
    val ids = lock.synchronized:
      bindings.get(sessionId) match
        case Some(b) =>
          val taken = b.toolCallIds
          bindings = bindings.updated(sessionId, b.copy(toolCallIds = Vector.empty, toolArgs = Map.empty))
          taken
        case None => Vector.empty
    attachEnding(sessionId, onTurnEnd(sessionId, runId, ids))

  private def drain(sessionId: String): Future[Unit] =
    snapshot(sessionId).flatMap(_.ending).filterNot(_.isCompleted).getOrElse(Future.unit)

  private def startTurn(cmd: AgentAttachProtocol.Command.SubmitUserMessage): Future[Admit] =
    liveOf(cmd.sessionId) match
      case Some(live) =>
        prompt(cmd.sessionId, "queue", cmd.text, cmd.images).map:
          case Right(_) => Admit.Accepted(live)
          case Left(e)  => Admit.Rejected(e)
      case None =>
        val runId = s"${cmd.sessionId}:${cmd.clientMessageId}"
        if !claimLive(cmd.sessionId, runId) then
          liveOf(cmd.sessionId) match
            case Some(live) =>
              prompt(cmd.sessionId, "queue", cmd.text, cmd.images).map:
                case Right(_) => Admit.Accepted(live)
                case Left(e)  => Admit.Rejected(e)
            case None => Future.successful(Admit.Rejected("cwd missing"))
        else
          onTurnBegin(cmd.sessionId, runId).transformWith:
            case Failure(e) =>
              log.error(s"dsh turn begin capture failed session=${cmd.sessionId} run=$runId: ${e.getMessage}", e)
              afterBegin(cmd.sessionId, runId, cmd.text, cmd.images)
            case Success(_) =>
              afterBegin(cmd.sessionId, runId, cmd.text, cmd.images)

  private def afterBegin(
      sessionId: String,
      runId: String,
      text: String,
      images: List[AgentAttachProtocol.SubmitImage]
  ): Future[Admit] =
    if liveOf(sessionId).contains(runId) then
      prompt(sessionId, "queue", text, images).transform:
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
  private def failAdmitted(sessionId: String, runId: String, message: String): Unit =
    lock.synchronized:
      if liveOf(sessionId).contains(runId) then
        offerSerial(sessionId, List(RunFailed(sessionId, runId, message)))
    settle(sessionId, runId)

  private def attachEnding(sessionId: String, end: Future[Unit]): Unit =
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

  private def clearEnding(sessionId: String): Unit =
    lock.synchronized:
      bindings.get(sessionId).foreach: cur =>
        if cur.ending.exists(_.isCompleted) then
          bindings = bindings.updated(sessionId, cur.copy(ending = None))

  private def claimLive(sessionId: String, runId: String): Boolean =
    lock.synchronized:
      bindings.get(sessionId) match
        case Some(b) if b.liveRunId.isDefined => false
        case Some(b) =>
          bindings = bindings.updated(sessionId, b.copy(liveRunId = Some(runId), toolCallIds = Vector.empty, toolArgs = Map.empty))
          true
        case None => false

  private def onAsked(asked: Mux.ApprovalAsked): Unit =
    resolveHost(asked.sessionId): parent =>
      lock.synchronized:
        bindings.get(parent).foreach: b =>
          val runId = if asked.sessionId == parent then b.liveRunId.getOrElse("") else ""
          val pending = PendingApproval(asked.approvalId, asked.rpcId, asked.sessionId)
          val next = b.copy(approvals = b.approvals.updated(asked.approvalId, pending))
          bindings = bindings.updated(
            parent,
            if b.approvals.contains(asked.approvalId) then next
            else
              rowsOf(
                next,
                List(
                  ApprovalRequested(
                    parent,
                    runId,
                    asked.approvalId,
                    dshTool(asked.tool),
                    dshRisk(asked.tool, asked.reason),
                    asked.reason.getOrElse(asked.tool),
                    asked.callId.flatMap(b.toolArgs.get).getOrElse(""),
                    asked.reason.map(_.trim).filter(_.nonEmpty).getOrElse("")
                  )
                )
              )
          )
      if asked.sessionId != parent then maybeNotifyOpen(parent)

  private def onDone(done: Mux.ApprovalDone): Unit =
    resolveHost(done.sessionId): parent =>
      lock.synchronized:
        bindings.get(parent).foreach: b =>
          val runId = b.liveRunId.getOrElse("")
          val ev: AgentEvent = done.outcome match
            case "allowed-once" => ApprovalResolved(parent, runId, done.approvalId, approved = true)
            case "rejected"     => ApprovalResolved(parent, runId, done.approvalId, approved = false)
            case other          => ApprovalExpired(parent, runId, done.approvalId, other)
          val cleared = b.copy(approvals = b.approvals - done.approvalId)
          bindings = bindings.updated(parent, rowsOf(cleared, List(ev)))

  private def onQuestionAsked(asked: Mux.QuestionAsked): Unit =
    val items = batchItemsOf(asked.payload)
    if items.isEmpty then
      System.err.println(s"dsh question/requested empty session=${asked.sessionId} rpcId=${asked.rpcId}")
    else
      resolveHost(asked.sessionId): parent =>
        lock.synchronized:
          bindings.get(parent).foreach: b =>
            val runId = if asked.sessionId == parent then b.liveRunId.getOrElse("") else ""
            val next = b.copy(questions = b.questions.updated(asked.rpcId, PendingQuestion(asked.rpcId, asked.sessionId, items)))
            bindings = bindings.updated(
              parent,
              rowsOf(next, List(QuestionBatchRequested(parent, runId, asked.rpcId, items)))
            )
        if asked.sessionId != parent then maybeNotifyOpen(parent)

  private def onQuestionDone(done: Mux.QuestionDone): Unit =
    resolveHost(done.sessionId): parent =>
      lock.synchronized:
        bindings.get(parent).foreach: b =>
          val runId = b.liveRunId.getOrElse("")
          val cleared = b.copy(questions = b.questions - done.questionRpcId)
          bindings = bindings.updated(
            parent,
            rowsOf(cleared, List(QuestionBatchResolved(parent, runId, done.questionRpcId, done.outcome)))
          )

  private def rowsOf(b: Binding, events: List[AgentEvent]): Binding =
    writeInto(b, events)

  private def offerSerial(sessionId: String, events: List[AgentEvent]): Unit =
    if events.nonEmpty then
      ingress.offer(IngressOffer(sessionId, sessionId, None, None, false, DshBatch(sessionId, events)))

  private def writeInto(b: Binding, events: List[AgentEvent]): Binding =
    events.foldLeft(b): (cur, e) =>
      e match
        case t: TaskUpdated => writeUi(cur, t)
        case ToolStarted(sid, rid, id, name, a) if !dshKnownTool(name) =>
          val after = writeRow(cur, payloadJson(e), e)
          writeRow(after, dshToolCardPayload(sid, rid, id, name, name, a), e, track = false)
        case _ => writeRow(cur, payloadJson(e), e)

  private def writeRow(cur: Binding, payload: Json, e: AgentEvent, track: Boolean = true): Binding =
    val seq = cur.seq + 1
    val row = EventRow(seq, Json.obj("payload" -> payload).noSpaces)
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
      seq = seq,
      liveRunId = liveNext,
      toolCallIds = ids,
      toolArgs = args,
      rows = (cur.rows :+ row).takeRight(bufferCap)
    )

  private def writeNdjson(sessionId: String, payload: Json): Unit =
    lock.synchronized:
      bindings.get(sessionId).foreach: b =>
        val seq = b.seq + 1
        val row = EventRow(seq, Json.obj("payload" -> payload).noSpaces)
        bindings = bindings.updated(sessionId, b.copy(seq = seq, rows = (b.rows :+ row).takeRight(bufferCap)))

  private def writeGoal(sessionId: String, data: Json): Option[Json] =
    val payload = dshGoalPayload(sessionId, data)
    writeNdjson(sessionId, payload)
    if liveOf(sessionId).isEmpty then Some(payload) else None

  private def writeUi(b: Binding, e: TaskUpdated): Binding =
    val row = EventRow(0L, Json.obj("payload" -> payloadJson(e)).noSpaces)
    b.copy(uiLive = b.uiLive.updated(e.taskId, row))

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

  private def maybeBudgetCancel(sessionId: String): Unit =
    lock.synchronized:
      bindings.get(sessionId).foreach: b =>
        val n = b.turns + 1
        bindings = bindings.updated(sessionId, b.copy(turns = n))
        if maxTurns.exists(n >= _) then
          remote.call("session.cancel", Json.obj("sessionId" -> sessionId.asJson))
          ()

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

  private def dropQuestion(sessionId: String, rpcId: String): Unit =
    lock.synchronized:
      bindings.get(sessionId).foreach: b =>
        bindings = bindings.updated(sessionId, b.copy(questions = b.questions - rpcId))

  private def snapshot(sessionId: String): Option[Binding] =
    lock.synchronized(bindings.get(sessionId))

  private def liveOf(sessionId: String): Option[String] =
    snapshot(sessionId).flatMap(_.liveRunId)

  private def setLive(sessionId: String, runId: Option[String]): Unit =
    lock.synchronized:
      bindings.get(sessionId).foreach: b =>
        bindings = bindings.updated(sessionId, b.copy(liveRunId = runId))

  private def bindRestore(sessionId: String, lastSeq: Option[Long]): Unit =
    val cwd = cwdOf(sessionId)
    lock.synchronized:
      val prev = bindings.getOrElse(sessionId, Binding(cwd))
      bindings = bindings.updated(sessionId, putLive(prev, dshCapsRow(sessionId, queue = true, goal = true, budget = false)))
      lastSeq.foreach(s => ingress.consume(sessionId, sessionId, s))
    kickLists()

  private def fillChildHistory(parent: String): Future[Unit] =
    remote.call("subagent.list", Json.obj("parentSessionId" -> parent.asJson)).flatMap: json =>
      val ids =
        valueOf(json).toOption.toList.flatMap: value =>
          value.hcursor.downField("entries").as[List[Json]].toOption.getOrElse(Nil).flatMap: e =>
            if e.hcursor.get[String]("kind").toOption.contains("child") then
              e.hcursor.get[String]("id").toOption.map(_.trim).filter(_.nonEmpty)
            else None
      Future.traverse(ids)(id => remote.call("subagent.history", Json.obj("sessionId" -> id.asJson)).map(id -> _)).map:
        pairs =>
          lock.synchronized:
            bindings.get(parent).foreach: b =>
              bindings = bindings.updated(parent, b.copy(childHistory = pairs.toMap))

  private def hostOf(muxSid: String): Option[String] =
    if bindings.contains(muxSid) then Some(muxSid) else childToParent.get(muxSid)

  private def resolveHost(muxSid: String)(use: String => Unit): Unit =
    lock.synchronized(hostOf(muxSid)) match
      case Some(parent) => use(parent)
      case None         => discover(muxSid, None, Some(use))

  private def discover(unknownSid: String, frame: Option[Json], use: Option[String => Unit] = None): Unit =
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

  private def kickLists(): Unit =
    val pending =
      lock.synchronized:
        if unknown.isEmpty then Nil
        else
          val ids = bindings.keys.toList.filterNot(listing.contains)
          listing = listing ++ ids
          ids
    pending.foreach(listParent)

  private def refreshCatalog(parent: String): Unit =
    val skip =
      lock.synchronized:
        if listing.contains(parent) then
          listAgain = listAgain + parent
          true
        else
          listing = listing + parent
          false
    if !skip then listParent(parent)

  private def listParent(parent: String): Unit =
    lock.synchronized:
      listTick += 1
      listBegan = listBegan.updated(parent, listTick)
    whenReady(remote.call("subagent.list", Json.obj("parentSessionId" -> parent.asJson))):
      case Success(json) =>
        afterList(parent, ingestCatalog(parent, json))
      case Failure(e) =>
        log.warn(s"dsh subagent.list: ${e.getMessage}", e)
        afterList(parent, ok = false)

  private def afterList(parent: String, ok: Boolean): Unit =
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

  private def flushUnknown(): List[() => Unit] =
    unknown.toList.flatMap: (sid, work) =>
      hostOf(sid) match
        case Some(parent) =>
          unknown = unknown - sid
          List: () =>
            work.frames.foreach(onChildEvent(parent, sid, _))
            work.uses.foreach(_(parent))
        case None => Nil

  private def concludeMisses(): Unit =
    val now = nowMs()
    val parents = bindings.keys.toList
    if parents.isEmpty then ()
    else
      val (stale, fresh) = unknown.partition: (sid, work) =>
        hostOf(sid).isEmpty && parents.forall(p => listFresh.get(p).exists(_ >= work.queuedAt))
      stale.keys.foreach: sid =>
        missUntil = missUntil.updated(sid, now + 2000)
      unknown = fresh

  private def ingestCatalog(parent: String, json: Json): Boolean =
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
                else if prev.exists(p => !p.turnOpen && p.activity == "running") then
                  setActivity(parent, id, "inactive")
                  appendParent(parent, List(SubagentUpdated(parent, id, "inactive")))
            case _ => ()
        true

  private def registerChild(parent: String, childSid: String, mode: String, label: String): Unit =
    lock.synchronized:
      childToParent = childToParent.updated(childSid, parent)
      missUntil = missUntil - childSid
      bindings.get(parent).foreach: b =>
        val prev = b.children.getOrElse(childSid, ChildWork(childSid, mode, label, "inactive"))
        val next = prev.copy(mode = mode, label = if label.nonEmpty then label else prev.label)
        bindings = bindings.updated(parent, b.copy(children = b.children.updated(childSid, next)))

  private def ensureStarted(parent: String, childSid: String, mode: String, label: String): Unit =
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

  private def markTurnStart(parent: String, childSid: String, at: Option[Long]): Unit =
    at.foreach: t =>
      lock.synchronized:
        bindings.get(parent).foreach: b =>
          b.children.get(childSid).foreach: c =>
            bindings = bindings.updated(
              parent,
              b.copy(children = b.children.updated(childSid, c.copy(lastStartTime = Some(t))))
            )

  private def setActivity(parent: String, childSid: String, activity: String, turnOpen: Option[Boolean] = None): Unit =
    lock.synchronized:
      bindings.get(parent).foreach: b =>
        b.children.get(childSid).foreach: c =>
          bindings = bindings.updated(
            parent,
            b.copy(children = b.children.updated(childSid, c.copy(activity = activity, turnOpen = turnOpen.getOrElse(c.turnOpen))))
          )

  private def idleSettled(parent: String, childSid: String, settledAt: Option[Long]): Unit =
    snapshot(parent).flatMap(_.children.get(childSid)) match
      case Some(c) if c.activity == "running" && !dshSettledStale(settledAt, c.lastStartTime) =>
        writeChildPreview(parent, childSid, activity = Some("inactive"))
      case _ => ()

  private def childMeta(parent: String, childSid: String): (String, String) =
    snapshot(parent).flatMap(_.children.get(childSid)).map(c => (c.mode, c.label)).getOrElse(("one-shot", ""))

  private def onChildEvent(parent: String, childSid: String, event: Json): Unit =
    val raw = event.hcursor.downField("payload").downField("event").focus.getOrElse(event)
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
        dshPreviewDelta(data, t).foreach: delta =>
          writeChildPreview(parent, childSid, append = Some(delta -> t))

  private def writeChildPreview(
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
                b.copy(children = b.children.updated(childSid, c.copy(preview = nextPreview)))
              )
            case _ =>
              val next = c.copy(
                activity = nextActivity,
                turnOpen = nextTurnOpen,
                preview = nextPreview,
                lastPreviewEmitMs = Some(now)
              )
              bindings = bindings.updated(
                parent,
                rowsOf(
                  b.copy(children = b.children.updated(childSid, next)),
                  SubagentUpdated(parent, childSid, nextActivity, Some(nextPreview)) :: extra
                )
              )

  private def appendParent(parent: String, events: List[AgentEvent]): Unit =
    lock.synchronized:
      bindings.get(parent).foreach: b =>
        bindings = bindings.updated(parent, rowsOf(b, events))

  private def maybeNotifyOpen(parent: String): Unit =
    if snapshot(parent).exists(_.liveRunId.isEmpty) && childOpen(parent) then onChildOpen(parent)

  private def whenReady(f: Future[Json])(use: Try[Json] => Unit): Unit =
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

def dshSourceKind(raw: Json): Option[String] =
  raw.hcursor.downField("data").downField("source").get[String]("kind").toOption

def dshSenderSessionId(raw: Json): Option[String] =
  raw.hcursor.downField("data").downField("source").get[String]("senderSessionId").toOption
    .map(_.trim)
    .filter(_.nonEmpty)

def dshEventTime(raw: Json): Option[Long] =
  raw.hcursor.get[Long]("time").toOption

def dshSettled(raw: Json): Boolean =
  raw.hcursor.get[String]("type").toOption.contains("user/message") &&
    dshSourceKind(raw).contains("subagent-settled")

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

def batchItemsOf(payload: Json): List[QuestionBatchItem] =
  payload.hcursor.downField("questions").as[List[Json]].toOption.getOrElse(Nil).flatMap: j =>
    val c = j.hcursor
    for
      id <- c.get[String]("id").toOption.map(_.trim).filter(_.nonEmpty)
      q <- c.get[String]("question").toOption.map(_.trim).filter(_.nonEmpty)
    yield
      val options = c.downField("options").as[List[Json]].toOption.getOrElse(Nil).flatMap: o =>
        o.hcursor.get[String]("label").toOption.map(_.trim).filter(_.nonEmpty).map: label =>
          QuestionBatchOption(label, o.hcursor.get[String]("description").toOption.map(_.trim).filter(_.nonEmpty))
      val intent = for
        kind <- c.downField("intent").get[String]("kind").toOption.map(_.trim).filter(_.nonEmpty)
        approve <- c.downField("intent").get[String]("approve").toOption.map(_.trim).filter(_.nonEmpty)
      yield QuestionBatchIntent(kind, approve)
      QuestionBatchItem(
        id,
        q,
        c.get[String]("detail").toOption.map(_.trim).filter(_.nonEmpty),
        c.get[String]("header").toOption.map(_.trim).filter(_.nonEmpty),
        options,
        c.get[Boolean]("multiSelect").toOption.getOrElse(false),
        intent
      )

def batchAnswersMatch(asked: List[QuestionBatchItem], answers: List[QuestionBatchAnswer]): Boolean =
  answers.length == asked.length && answers.zip(asked).forall: (a, q) =>
    val custom = a.custom.map(_.trim).filter(_.nonEmpty)
    a.id == q.id &&
      a.selected.distinct.length == a.selected.length &&
      !a.custom.exists(_.trim.isEmpty) &&
      (q.multiSelect || (custom.isEmpty || a.selected.isEmpty) && a.selected.length <= 1) &&
      a.selected.forall(label => q.options.exists(_.label == label))

def batchReply(sessionId: String, answers: List[QuestionBatchAnswer]): Json =
  Json.obj(
    "sessionId" -> sessionId.asJson,
    "answer" -> Json.obj(
      "answers" -> Json.fromValues(answers.map: a =>
        val base = Json.obj("id" -> a.id.asJson, "selected" -> a.selected.asJson)
        a.custom.map(_.trim).filter(_.nonEmpty).fold(base): c =>
          base.deepMerge(Json.obj("custom" -> c.asJson))
      )
    )
  )
