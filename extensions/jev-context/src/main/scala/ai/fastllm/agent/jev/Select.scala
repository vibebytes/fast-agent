package ai.fastllm.agent.jev

import ai.fastllm.agent.ext.{ContextSelector, Settings}
import io.circe.Json
import io.circe.syntax.*
import org.slf4j.LoggerFactory

import java.util.concurrent.{ScheduledThreadPoolExecutor, TimeUnit}
import scala.concurrent.{ExecutionContext, Future, Promise}
import scala.util.{Failure, Success}
import scala.util.control.NonFatal

/** Bump when the question text changes. Not sent on the wire. */
val QuestionSetVersion = 1

val Model = "jev-1.13.0"

val Endpoint = "https://api.typesafe.ai/v1/systemone"

/** One systemone call. `ContextSelect.TimeoutMs` stays above this plus the settings read. */
val ClientTimeoutMs: Long = 8000

val Keep: Json = Json.obj("action" -> "keep".asJson)

private[jev] val log = LoggerFactory.getLogger("ai.fastllm.agent.jev.Select")

private val Residents = Set("read_file", "grep", "write_file", "edit_file", "shell")

private val NotePrefixes = List("<previous-summary>", "<context-summarized>", "<context-dropped>")

private val clock =
  val threads = new ScheduledThreadPoolExecutor(1, (r: Runnable) =>
    val t = new Thread(r, "jev-context")
    t.setDaemon(true)
    t
  )
  threads.setRemoveOnCancelPolicy(true)
  threads

enum Fault:
  case Timeout
  case Status(code: Int)
  case Connection
  case Bad(detail: String)

  def text: String = this match
    case Timeout => "timeout"
    case Status(code) => s"HTTP $code"
    case Connection => "connection failed"
    case Bad(detail) => detail

trait JevPost:
  def post(body: Json, bearer: String): Future[Either[Fault, Json]]

def menuInstructions(id: String): String =
  s"Given the user request and `candidates.$id.description`, does the agent need `candidates.$id` available for this request?"

def historyInstructions(id: String): String =
  s"Given the current user request, is `history.$id` still needed to respond? `history.$id` is prior conversation, a prior tool call, or a prior tool result."

private final case class ToolRow(id: String, description: String)
private final case class SkillRow(name: String, description: String)
private final case class Row(
    index: Int,
    role: String,
    content: String,
    synthetic: Boolean,
    hasImages: Boolean,
    tools: List[String]
)

private enum Outcome:
  case Skip
  case Failed
  case Scores(values: Map[String, Double])

private final case class Planned(
    menu: Option[Json],
    questionIds: List[String],
    toolQuestion: Map[String, String],
    skillQuestion: Map[String, String],
    aliases: List[String],
    sticky: Set[String],
    askedSkills: Boolean,
    history: Option[Json],
    historyIds: List[String],
    historyIndexes: Map[String, List[Int]],
    toolOrder: List[String],
    skillOrder: List[String],
    forced: Set[Int],
    messageCount: Int
)

final class Selector(
    settings: Settings,
    post: JevPost = HttpJev,
    timeoutMs: Long = ClientTimeoutMs
) extends ContextSelector:
  def select(inventory: Json): Future[Json] =
    given ExecutionContext = ExecutionContext.parasitic
    val pass = passOf(inventory)
    settings.current().transform {
      case Success(doc) => Success(doc)
      case Failure(e) =>
        log.warn("[jev-context] {} settings: {}", pass, e.getClass.getSimpleName)
        Success(Json.obj())
    }.flatMap: doc =>
      route(doc, inventory, pass).map(stamp(doc, _))

  private def route(doc: Json, inventory: Json, pass: String): Future[Json] =
    given ExecutionContext = ExecutionContext.parasitic
    val id = doc.hcursor.get[String]("secretId").toOption.filter(_.nonEmpty)
    if !armed(doc) || id.isEmpty then Future.successful(Keep)
    else if isTurn(inventory) && !eachTurn(doc) then Future.successful(Keep)
    else
      val planned = if isTurn(inventory) then planTurn(inventory) else plan(inventory)
      planned match
        case None => Future.successful(Keep)
        case Some(next) =>
          settings.secret(id.get).transform {
            case Success(key) => Success(key)
            case Failure(e) =>
              log.warn("[jev-context] {} settings: {}", pass, e.getClass.getSimpleName)
              Success(None)
          }.flatMap:
            case Some(key) if key.nonEmpty => dispatch(next, key, pass)
            case _ => Future.successful(Keep)

  private def dispatch(planned: Planned, key: String, pass: String): Future[Json] =
    given ExecutionContext = ExecutionContext.parasitic
    if planned.menu.isDefined && planned.aliases.nonEmpty then
      log.info("[jev-context] {} menu: split {}", pass, planned.aliases.mkString(","))
    if planned.menu.isDefined && planned.sticky.nonEmpty then
      log.info("[jev-context] {} menu: keep duplicate {}", pass, planned.sticky.mkString(","))
    val menuF = run(pass, "menu", planned.menu, planned.questionIds, key)
    val histF = run(pass, "history", planned.history, planned.historyIds, key)
    menuF.zip(histF).map((menu, hist) => finish(assemble(planned, menu, hist), pass))

  private def run(pass: String, which: String, body: Option[Json], ids: List[String], key: String): Future[Outcome] =
    given ExecutionContext = ExecutionContext.parasitic
    body match
      case None => Future.successful(Outcome.Skip)
      case Some(json) =>
        val noun = if ids.size == 1 then "question" else "questions"
        log.info("[jev-context] {} {}: sent {} {} to Jev", pass, which, ids.size, noun)
        val sent =
          try post.post(json, key)
          catch case NonFatal(_) => Future.successful(Left(Fault.Connection))
        bounded(sent).map: result =>
          val scored = result.flatMap(parseScores(_, ids))
          scored.left.foreach: f =>
            val detail = if f == Fault.Timeout then s"timeout ${timeoutMs}ms" else f.text
            log.warn("[jev-context] {} {}: {}", pass, which, detail)
          scored match
            case Left(_) => Outcome.Failed
            case Right(scores) =>
              log.info("[jev-context] {} {}: Jev kept {}/{}", pass, which, scores.values.count(_ >= 0.5), ids.size)
              Outcome.Scores(scores)

  private def bounded(body: Future[Either[Fault, Json]]): Future[Either[Fault, Json]] =
    val done = Promise[Either[Fault, Json]]()
    val timer = clock.schedule(
      new Runnable:
        def run(): Unit = done.trySuccess(Left(Fault.Timeout))
      ,
      timeoutMs,
      TimeUnit.MILLISECONDS
    )
    body.onComplete {
      case Success(value) =>
        timer.cancel(false)
        done.trySuccess(value)
      case Failure(_) =>
        timer.cancel(false)
        done.trySuccess(Left(Fault.Connection))
    }(using ExecutionContext.parasitic)
    done.future

private def armed(doc: Json): Boolean =
  doc.hcursor.get[Boolean]("jevContext").toOption.contains(true)

private def eachTurn(doc: Json): Boolean =
  armed(doc) && doc.hcursor.get[Boolean]("eachTurn").toOption.contains(true)

private def isTurn(inventory: Json): Boolean =
  inventory.hcursor.get[String]("pass").toOption.contains("turn")

private def stamp(doc: Json, result: Json): Json =
  if eachTurn(doc) then result.deepMerge(Json.obj("eachTurn" -> true.asJson)) else result

private def plan(inventory: Json): Option[Planned] =
  val rows = rowsOf(inventory)
  if rows.isEmpty then None
  else
    val current = inventory.hcursor.get[Int]("current").toOption.getOrElse(rows.length - 1)
    if current < 0 || current >= rows.length then None
    else
      val request = rows(current).content
      val grouped = units(rows)
      val start = protectStart(grouped)
      val forced = forcedIndexes(grouped, start, current)
      val questions = historyQuestions(grouped, start, current)
      val tools = toolsOf(inventory)
      val skills = skillsOf(inventory)
      val asked = menuAsked(tools, skills)
      val askedNames = asked.map(_.name).toSet
      val sticky =
        tools.iterator.map(_.id).filter(id => !Residents.contains(id) && !askedNames.contains(id)).toSet
          ++ skills.iterator.map(_.name).filterNot(askedNames.contains)
      val menuBody =
        if asked.size <= 8 then None
        else Some(payload(
          menuState(request, asked.map(a => a.questionId -> a.description)),
          asked.map(a => a.questionId -> menuInstructions(a.questionId))
        ))
      val histBody =
        if questions.isEmpty then None
        else
          val pairs = questions.map(q => q.id -> historyInstructions(q.id))
          Some(payload(historyState(request, questions), pairs))
      if menuBody.isEmpty && histBody.isEmpty then None
      else
        val sent = if menuBody.isDefined then asked else Nil
        Some(Planned(
          menu = menuBody,
          questionIds = sent.map(_.questionId),
          toolQuestion = sent.collect { case Asked(Side.Tool, name, qid, _) => name -> qid }.toMap,
          skillQuestion = sent.collect { case Asked(Side.Skill, name, qid, _) => name -> qid }.toMap,
          aliases = sent.collect { case Asked(_, name, qid, _) if qid != name => qid },
          sticky = if menuBody.isDefined then sticky else Set.empty,
          askedSkills = sent.exists(_.side == Side.Skill),
          history = histBody,
          historyIds = questions.map(_.id),
          historyIndexes = questions.map(q => q.id -> q.indexes).toMap,
          toolOrder = tools.map(_.id),
          skillOrder = skills.map(_.name),
          forced = forced,
          messageCount = rows.length
        ))

/** Later model calls. The body sent to Jev contains history questions only. */
private def planTurn(inventory: Json): Option[Planned] =
  val rows = rowsOf(inventory)
  if rows.isEmpty then None
  else
    val requestAt = inventory.hcursor.get[Int]("request").toOption.getOrElse(-1)
    val current = inventory.hcursor.get[Int]("current").toOption.getOrElse(rows.length - 1)
    if requestAt < 0 || requestAt >= rows.length || current < 0 || current >= rows.length then None
    else
      val grouped = units(rows)
      val requestUnit = grouped.indexWhere(_.exists(_.index == requestAt))
      val lastTool = grouped.lastIndexWhere(g => g.head.role == "assistant" && g.head.tools.nonEmpty)
      val span = if requestUnit < 0 || lastTool < 0 then Nil else grouped.slice(requestUnit + 1, lastTool)
      val questions = questionsFrom(span, current)
      if questions.isEmpty then None
      else
        val asked = questions.flatMap(_.indexes).toSet
        Some(Planned(
          menu = None,
          questionIds = Nil,
          toolQuestion = Map.empty,
          skillQuestion = Map.empty,
          aliases = Nil,
          sticky = Set.empty,
          askedSkills = false,
          history = Some(payload(
            historyState(rows(requestAt).content, questions),
            questions.map(q => q.id -> historyInstructions(q.id))
          )),
          historyIds = questions.map(_.id),
          historyIndexes = questions.map(q => q.id -> q.indexes).toMap,
          toolOrder = Nil,
          skillOrder = Nil,
          forced = rows.indices.filterNot(asked.contains).toSet,
          messageCount = rows.length
        ))

private def assemble(planned: Planned, menu: Outcome, hist: Outcome): Json =
  val tools = menu match
    case Outcome.Scores(scores) =>
      Some(planned.toolOrder.filter(id =>
        Residents.contains(id) || planned.sticky.contains(id) || kept(scores, planned.toolQuestion.get(id))
      ))
    case _ => None
  val skills = menu match
    case Outcome.Scores(scores) if planned.askedSkills =>
      Some(planned.skillOrder.filter(name => planned.sticky.contains(name) || kept(scores, planned.skillQuestion.get(name))))
    case _ => None
  val messages = hist match
    case Outcome.Scores(scores) =>
      val yes = scores.collect { case (id, n) if n >= 0.5 => planned.historyIndexes.getOrElse(id, Nil) }.flatten.toSet
      Some((0 until planned.messageCount).filter(i => planned.forced.contains(i) || yes.contains(i)).toList)
    case _ => None
  if tools.isEmpty && skills.isEmpty && messages.isEmpty then Keep
  else
    val fields = List(
      Some("action" -> "select".asJson),
      tools.map(xs => "tools" -> xs.asJson),
      skills.map(xs => "skills" -> xs.asJson),
      messages.map(xs => "messages" -> xs.asJson)
    ).flatten
    Json.obj(fields*)

private def kept(scores: Map[String, Double], questionId: Option[String]): Boolean =
  questionId.exists(id => scores.get(id).exists(_ >= 0.5))

private enum Side:
  case Tool, Skill

private final case class Asked(side: Side, name: String, questionId: String, description: String)

private def menuAsked(tools: List[ToolRow], skills: List[SkillRow]): List[Asked] =
  val raw =
    tools.filterNot(t => Residents.contains(t.id)).map(t => Asked(Side.Tool, t.id, t.id, t.description))
      ++ skills.map(s => Asked(Side.Skill, s.name, s.name, s.description))
  val byName = raw.groupBy(_.name)
  val tagged = raw.flatMap: item =>
    byName(item.name) match
      case many if many.size > 1 && many.map(_.side).distinct.size == many.size =>
        val qid = item.side match
          case Side.Tool => s"tool:${item.name}"
          case Side.Skill => s"skill:${item.name}"
        Some(item.copy(questionId = qid))
      case many if many.size > 1 => None
      case _ => Some(item)
  val clashes = tagged.groupBy(_.questionId).collect { case (id, xs) if xs.size > 1 => id }.toSet
  tagged.filterNot(item => clashes.contains(item.questionId))

private def finish(result: Json, pass: String): Json =
  val c = result.hcursor
  val action = c.get[String]("action").toOption.getOrElse("keep")
  val parts = List("tools", "skills", "messages").filter(name => c.downField(name).focus.isDefined)
  if action == "select" && parts.nonEmpty then
    log.info("[jev-context] {}: rewrite {}", pass, parts.mkString(", "))
  else
    log.info("[jev-context] {}: keep the original lists", pass)
  result

private def passOf(inventory: Json): String =
  if isTurn(inventory) then "turn" else "init"

private def payload(state: Json, questions: List[(String, String)]): Json =
  Json.obj(
    "model" -> Model.asJson,
    "state" -> state,
    "questions" -> Json.obj(questions.map((id, text) =>
      id -> Json.obj("type" -> "noul".asJson, "instructions" -> text.asJson)
    )*)
  )

private def menuState(request: String, rows: List[(String, String)]): Json =
  Json.obj(
    "request" -> request.asJson,
    "candidates" -> Json.obj(rows.map((id, description) =>
      id -> Json.obj("id" -> id.asJson, "description" -> description.asJson)
    )*)
  )

private final case class HistQ(rows: List[Row]):
  def indexes: List[Int] = rows.map(_.index)
  def id: String = indexes.mkString(",")
  def role: String = rows.head.role
  def tools: List[String] = rows.flatMap(_.tools).distinct
  def text: String = rows.map(_.content).mkString("\n")

private def historyState(request: String, questions: List[HistQ]): Json =
  Json.obj(
    "request" -> request.asJson,
    "history" -> Json.obj(questions.map(q =>
      q.id -> Json.obj(
        "indexes" -> q.indexes.asJson,
        "role" -> q.role.asJson,
        "tools" -> q.tools.asJson,
        "text" -> q.text.asJson
      )
    )*)
  )

private def parseScores(body: Json, ids: List[String]): Either[Fault, Map[String, Double]] =
  body.hcursor.downField("answers").focus.flatMap(_.asObject) match
    case None => Left(Fault.Bad("missing answers"))
    case Some(obj) =>
      ids.foldLeft[Either[Fault, Map[String, Double]]](Right(Map.empty)): (acc, id) =>
        acc.flatMap: scores =>
          obj(id) match
            case None => Left(Fault.Bad("missing answer"))
            case Some(json) =>
              val cursor = json.hcursor
              if cursor.get[String]("type").toOption != Some("noul") then Left(Fault.Bad("not noul"))
              else
                cursor.get[Double]("noul").toOption match
                  case Some(p) if p >= 0 && p <= 1 && !p.isNaN => Right(scores.updated(id, p))
                  case _ => Left(Fault.Bad("probability out of range"))

private def toolsOf(json: Json): List[ToolRow] =
  json.hcursor.downField("tools").as[List[Json]].getOrElse(Nil).flatMap: item =>
    item.hcursor.get[String]("id").toOption.map(id =>
      ToolRow(id, item.hcursor.get[String]("description").toOption.getOrElse(""))
    )

private def skillsOf(json: Json): List[SkillRow] =
  json.hcursor.downField("skills").as[List[Json]].getOrElse(Nil).flatMap: item =>
    item.hcursor.get[String]("name").toOption.map(name =>
      SkillRow(name, item.hcursor.get[String]("description").toOption.getOrElse(""))
    )

private def rowsOf(json: Json): List[Row] =
  json.hcursor.downField("messages").as[List[Json]].getOrElse(Nil).zipWithIndex.map: (item, i) =>
    val cursor = item.hcursor
    val calls = cursor.downField("toolCalls").as[List[Json]].getOrElse(Nil)
      .flatMap(_.hcursor.get[String]("name").toOption)
    Row(
      index = i,
      role = cursor.get[String]("role").getOrElse(""),
      content = cursor.get[String]("content").getOrElse(""),
      synthetic = cursor.get[Boolean]("synthetic").getOrElse(false),
      hasImages = cursor.get[Boolean]("hasImages").getOrElse(false),
      tools = calls
    )

private def units(rows: List[Row]): List[List[Row]] =
  val buf = List.newBuilder[List[Row]]
  var i = 0
  while i < rows.length do
    val row = rows(i)
    if row.role == "assistant" && row.tools.nonEmpty then
      val rest = List.newBuilder[Row]
      var j = i + 1
      while j < rows.length && rows(j).role == "tool" do
        rest += rows(j)
        j += 1
      buf += row :: rest.result()
      i = j
    else
      buf += List(row)
      i += 1
  buf.result()

private def protectStart(grouped: List[List[Row]]): Int =
  val anchors = grouped.indices.filter(i => isAnchor(grouped(i).head))
  if anchors.size >= 2 then anchors(anchors.size - 2)
  else if anchors.nonEmpty then anchors.head
  else
    val image = grouped.lastIndexWhere(_.exists(_.hasImages))
    if image >= 0 then image else math.max(grouped.size - 1, 0)

private def isAnchor(row: Row): Boolean =
  row.role == "user" && !row.synthetic && !row.hasImages

private def isNote(row: Row): Boolean =
  row.role == "user" && NotePrefixes.exists(row.content.startsWith)

private def loneTool(group: List[Row]): Boolean =
  group match
    case row :: Nil if row.role == "tool" => true
    case _ => false

private def forcedIndexes(grouped: List[List[Row]], start: Int, current: Int): Set[Int] =
  val tail = grouped.drop(start).flatten.map(_.index)
  val always = grouped.flatten.collect:
    case row if row.index == current || row.role == "system" || isNote(row) => row.index
  val lone = grouped.filter(loneTool).flatten.map(_.index)
  (tail ++ always ++ lone).toSet

private def historyQuestions(grouped: List[List[Row]], start: Int, current: Int): List[HistQ] =
  questionsFrom(grouped.take(start), current)

private def questionsFrom(groups: List[List[Row]], current: Int): List[HistQ] =
  val buf = List.newBuilder[HistQ]
  var i = 0
  while i < groups.length do
    val group = groups(i)
    if candidate(group, current) then
      val next = if i + 1 < groups.length then Some(groups(i + 1)) else None
      next match
        case Some(n) if group.exists(_.hasImages) && n.head.role == "assistant" && candidate(n, current) =>
          buf += HistQ(group ++ n)
          i += 2
        case _ =>
          buf += HistQ(group)
          i += 1
    else i += 1
  buf.result()

private def candidate(group: List[Row], current: Int): Boolean =
  !group.exists(_.index == current) &&
    group.head.role != "system" &&
    !group.exists(isNote) &&
    !loneTool(group)
