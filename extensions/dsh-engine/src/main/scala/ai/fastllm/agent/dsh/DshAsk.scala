package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.AgentAttachProtocol.Command.{AnswerQuestionBatch, QuestionBatchAnswer}
import ai.fastllm.agent.channel.AgentAttachProtocol.Event.{
  ApprovalExpired, ApprovalRequested, ApprovalResolved, QuestionBatchIntent, QuestionBatchItem,
  QuestionBatchOption, QuestionBatchRequested, QuestionBatchResolved, RunCancelled, RunCompleted,
  RunCreated, RunFailed, RunStateChanged, CheckpointEvent, ChildTranscriptDelta, SubagentFinished,
  SubagentStarted, SubagentUpdated, TaskUpdated, ToolStarted
}
import ai.fastllm.agent.channel.{
  Admit, AgentAttachProtocol, AgentEvent, EventRow, IngressOffer, RouteResult, RunMode, payloadJson
}
import ai.fastllm.agent.guardrail.{DangerousCommands, ExternalDirs}
import io.circe.Json
import io.circe.syntax.*
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}
import scala.util.control.NonFatal

/** Belong to [[DshLoop]]. Approval and question batch. */
trait DshAsk:
  this: DshLoop =>
  private given ExecutionContext = dshExec

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

  /** Yolo is unattended: answer the engine's ask here instead of surfacing a card.
    * The deny list is the whole policy: blacklisted shell commands and credential
    * roots stay refused; everything else is allowed once.
    * The river still settles on the engine's `approval/done`, exactly as a manual answer.
    */
  private def yoloApproval(parent: String, b: Binding, asked: Mux.ApprovalAsked): Unit =
    val context = asked.callId.flatMap(b.toolArgs.get).getOrElse("")
    val blocked = yoloRefusal(dshTool(asked.tool), context)
    val outcome = if blocked.isDefined then "rejected" else "allowed-once"
    if blocked.isDefined then log.warn(s"[yolo] refused ${asked.tool} sid=$parent: ${blocked.get}")
    else log.info(s"[yolo] approved ${asked.tool} sid=$parent context=${context.take(120)}")
    remote
      .reply(
        asked.rpcId,
        Json.obj(
          "sessionId" -> asked.sessionId.asJson,
          "approvalId" -> asked.approvalId.asJson,
          "outcome" -> outcome.asJson
        )
      )
      .failed
      .foreach(e => log.error(s"[yolo] approval reply failed sid=$parent: ${e.getMessage}"))

  /** Deny-list only: the reason a yolo ask is refused, or None to allow it once.
    * `context` is already the tool's path or command ([[dshContext]]), not the args JSON. */
  private def yoloRefusal(tool: String, context: String): Option[String] =
    val raw = context.trim
    if raw.isEmpty then None
    else if tool == "shell" then
      val words = raw.split("\\s+").toList.map(bareWord)
      DangerousCommands.denyReason(raw).orElse(credentialPath(words))
    else credentialPath(List(bareWord(raw)))

  private def credentialPath(candidates: List[String]): Option[String] =
    candidates.find(p => p.nonEmpty && ExternalDirs.isSensitive(p)).map(p => s"credential path $p")

  private def bareWord(word: String): String = word.replaceAll("^[\"'`(]+|[\"'`);,]+$", "")

  private[dsh] def onAsked(asked: Mux.ApprovalAsked): Unit =
    resolveHost(asked.sessionId): parent =>
      lock.synchronized:
        val yolo = bindings.get(parent).exists(_.mode == RunMode.Yolo)
        if yolo then bindings.get(parent).foreach(b => yoloApproval(parent, b, asked))
        else bindings.get(parent).foreach: b =>
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

  private[dsh] def onDone(done: Mux.ApprovalDone): Unit =
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

  private[dsh] def onQuestionAsked(asked: Mux.QuestionAsked): Unit =
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

  private[dsh] def onQuestionDone(done: Mux.QuestionDone): Unit =
    resolveHost(done.sessionId): parent =>
      lock.synchronized:
        bindings.get(parent).foreach: b =>
          val runId = b.liveRunId.getOrElse("")
          val cleared = b.copy(questions = b.questions - done.questionRpcId)
          bindings = bindings.updated(
            parent,
            rowsOf(cleared, List(QuestionBatchResolved(parent, runId, done.questionRpcId, done.outcome)))
          )

  private[dsh] def dropQuestion(sessionId: String, rpcId: String): Unit =
    lock.synchronized:
      bindings.get(sessionId).foreach: b =>
        bindings = bindings.updated(sessionId, b.copy(questions = b.questions - rpcId))

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
