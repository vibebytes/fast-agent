package ai.fastllm.agent.jev

import ai.fastllm.agent.ext.Settings
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import io.circe.Json
import io.circe.syntax.*
import org.scalatest.concurrent.ScalaFutures
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import org.scalatest.time.{Millis, Seconds, Span}
import org.slf4j.LoggerFactory

import java.util.concurrent.ConcurrentLinkedQueue
import scala.collection.mutable.ListBuffer
import scala.concurrent.{ExecutionContext, Future, Promise}
import scala.jdk.CollectionConverters.*

class SelectSpec extends AnyFunSuite with Matchers with ScalaFutures:
  private given ExecutionContext = ExecutionContext.parasitic
  private given PatienceConfig = PatienceConfig(timeout = Span(3, Seconds), interval = Span(15, Millis))

  private val bearer = "sk-test-bearer-should-not-leak"

  test("missing service or a closed switch does not call the transport"):
    val post = Script(_ => Left(Fault.Status(500)))
    val inventory = onlyCurrent
    Selector(Settings.empty, post).select(inventory).futureValue shouldBe Keep
    Selector(gate(Json.obj(), None), post).select(inventory).futureValue shouldBe Keep
    Selector(gate(Json.obj("jevContext" -> false.asJson), Some(bearer)), post).select(inventory).futureValue shouldBe Keep
    post.bodies shouldBe empty

  test("an open switch without a decoded bearer does not call the transport"):
    val post = Script(_ => Left(Fault.Status(500)))
    val doc = Json.obj("jevContext" -> true.asJson, "secretId" -> "s1".asJson)
    Selector(gate(doc, None), post).select(onlyCurrent).futureValue shouldBe Keep
    post.bodies shouldBe empty

  test("a settings read failure returns keep and does not call the transport"):
    val post = Script(_ => Left(Fault.Status(500)))
    val broken = new Settings:
      def current() = Future.failed(new IllegalStateException("db down"))
      def secret(id: String) = Future.successful(Some(bearer))
    val (result, warns) = watched(Selector(broken, post).select(wide).futureValue)
    result shouldBe Keep
    post.bodies shouldBe empty
    warns.exists(_.contains("settings")) shouldBe true
    warns.mkString should not include bearer

  test("no menu candidates and no history candidates returns keep"):
    val post = Script(_ => Left(Fault.Status(500)))
    Selector(open, post).select(onlyCurrent).futureValue shouldBe Keep
    post.bodies shouldBe empty

  test("menu and history requests are issued together and stay on their own state"):
    val post = Gate()
    val result = Selector(open, post, timeoutMs = 200).select(wide).futureValue
    post.bodies.size shouldBe 2
    val menu = post.bodies.asScala.find(_.hcursor.downField("state").downField("candidates").succeeded).get
    val hist = post.bodies.asScala.find(_.hcursor.downField("state").downField("history").succeeded).get
    menu.noSpaces should not include "ANCIENT-TURN"
    menu.hcursor.downField("state").downField("history").focus shouldBe None
    hist.noSpaces should not include "TOOL-DESC"
    hist.noSpaces should not include "SKILL-DESC"
    hist.hcursor.downField("state").downField("candidates").focus shouldBe None
    menu.hcursor.downField("state").downField("request").as[String] shouldBe Right("CURRENT-REQUEST")
    hist.hcursor.downField("state").downField("request").as[String] shouldBe Right("CURRENT-REQUEST")
    menu.hcursor.get[String]("model") shouldBe Right(Model)
    questionIds(menu) should not contain "read_file"
    post.bearers.asScala.foreach(_ shouldBe bearer)
    menu.noSpaces should not include bearer
    result.hcursor.get[String]("action") shouldBe Right("select")
    result.hcursor.downField("tools").as[List[String]].toOption.get should contain("read_file")
    result.hcursor.downField("tools").as[List[String]].toOption.get should not contain "shell"
    result.hcursor.downField("skills").as[List[String]].toOption.get should contain("keep-skill")

  test("a shared tool and skill name is asked as two questions"):
    val post = Script: body =>
      val scores = questionIds(body).map(id => id -> (if id == "skill:goal" then 0.1 else 0.9))
      Right(noulPairs(scores))
    val inventory = inventoryOf(
      ("goal" -> "run a goal") :: (1 to 7).map(i => s"filler-$i" -> "x").toList,
      List("goal" -> "goal skill"),
      List(message("user", "CURRENT-REQUEST"))
    )
    val (result, lines) = logged(Selector(open, post).select(inventory).futureValue)
    val menu = post.bodies.head
    val ids = questionIds(menu)
    ids should contain("tool:goal")
    ids should contain("skill:goal")
    ids should not contain "goal"
    result.hcursor.downField("tools").as[List[String]].toOption.get should contain("goal")
    result.hcursor.downField("skills").as[List[String]].toOption.get shouldBe Nil
    lines.exists(_.contains("menu: split tool:goal,skill:goal")) shouldBe true

  test("a repeated tool id stays while the other candidates are still asked"):
    val post = Script(body => Right(noul(questionIds(body), 0.1)))
    val inventory = inventoryOf(
      List("dup" -> "a", "dup" -> "b") ++ (1 to 9).map(i => s"filler-$i" -> "x"),
      Nil,
      List(message("user", "CURRENT-REQUEST"))
    )
    val (result, lines) = logged(Selector(open, post).select(inventory).futureValue)
    questionIds(post.bodies.head) should not contain "dup"
    result.hcursor.downField("tools").as[List[String]].toOption.get shouldBe List("dup", "dup")
    lines.exists(_.contains("menu: keep duplicate dup")) shouldBe true

  test("eight or fewer menu candidates skip the menu request and still judge a tool round"):
    val post = Script(body => Right(noul(questionIds(body), 0.9)))
    val inventory = inventoryOf(
      List("read_file" -> "resident", "grep" -> "search"),
      Nil,
      List(
        message("assistant", "round", tools = List("grep")),
        message("tool", "hit"),
        message("user", "anchor-a"),
        message("user", "CURRENT-REQUEST")
      )
    )
    val result = Selector(open, post).select(inventory).futureValue
    post.bodies should have size 1
    post.bodies.head.hcursor.downField("state").downField("candidates").focus shouldBe None
    questionIds(post.bodies.head) shouldBe List("0,1")
    result.hcursor.downField("tools").focus shouldBe None
    result.hcursor.downField("messages").as[List[Int]] shouldBe Right(List(0, 1, 2, 3))

  test("a fully protected history and a short menu returns keep"):
    val post = Script(_ => Left(Fault.Status(500)))
    val inventory = inventoryOf(
      List("grep" -> "search"),
      Nil,
      List(message("user", "earlier"), message("user", "CURRENT-REQUEST"))
    )
    Selector(open, post).select(inventory).futureValue shouldBe Keep
    post.bodies shouldBe empty

  test("noul at 0.5 stays and 0.49 goes"):
    val post = Script: body =>
      val scores = questionIds(body).map(id => id -> (if id.contains("drop") || id == "0" then 0.49 else 0.5))
      Right(noulPairs(scores))
    val result = Selector(open, post).select(wide).futureValue
    val tools = result.hcursor.downField("tools").as[List[String]].toOption.get
    tools should contain("read_file")
    tools should contain("keep-tool")
    tools should not contain "drop-tool"
    tools should not contain "shell"
    result.hcursor.downField("skills").as[List[String]].toOption.get shouldBe List("keep-skill")
    val messages = result.hcursor.downField("messages").as[List[Int]].toOption.get
    messages should not contain 0
    messages should contain(1)
    messages should contain(wideCurrent)

  test("a failed menu request still narrows messages"):
    val post = Script: body =>
      if body.hcursor.downField("state").downField("candidates").succeeded then Left(Fault.Status(500))
      else Right(noul(questionIds(body), 0.1))
    val (result, warns) = watched(Selector(open, post).select(wide).futureValue)
    result.hcursor.downField("tools").focus shouldBe None
    result.hcursor.downField("skills").focus shouldBe None
    val messages = result.hcursor.downField("messages").as[List[Int]].toOption.get
    messages should not contain 0
    messages should contain(wideCurrent)
    warns.count(_.contains("menu")) shouldBe 1
    warns.exists(_.contains("HTTP 500")) shouldBe true
    warns.mkString should not include bearer
    warns.mkString should not include "ANCIENT-TURN"

  test("a failed history request still narrows tools and skills"):
    val post = Script: body =>
      if body.hcursor.downField("state").downField("history").succeeded then Left(Fault.Connection)
      else Right(noul(questionIds(body), 0.9))
    val result = Selector(open, post).select(wide).futureValue
    result.hcursor.downField("messages").focus shouldBe None
    result.hcursor.downField("tools").as[List[String]].toOption.get should contain("keep-tool")
    result.hcursor.downField("skills").as[List[String]].toOption.get should contain("keep-skill")

  test("dropping a tool round drops the assistant index and the tool index together"):
    val post = Script(body => Right(noul(questionIds(body), 0.1)))
    val inventory = inventoryOf(
      List("grep" -> "search"),
      Nil,
      List(
        message("assistant", "round", tools = List("grep")),
        message("tool", "hit"),
        message("user", "anchor-a"),
        message("user", "CURRENT-REQUEST")
      )
    )
    val messages = Selector(open, post).select(inventory).futureValue.hcursor.downField("messages").as[List[Int]].toOption.get
    messages should not contain 0
    messages should not contain 1
    messages should contain(3)

  test("current, system, compaction notes, and the protected tail stay and are not questions"):
    val post = Script(body => Right(noul(questionIds(body), 0.1)))
    val inventory = inventoryOf(
      Nil,
      Nil,
      List(
        message("user", "<previous-summary> folded", synthetic = true),
        message("system", "sys"),
        message("user", "ANCIENT"),
        message("assistant", "reply"),
        message("user", "MID"),
        message("assistant", "mid-reply"),
        message("user", "CURRENT-REQUEST")
      )
    )
    val result = Selector(open, post).select(inventory).futureValue
    val asked = post.bodies.flatMap(questionIds)
    asked should not contain "0"
    asked should not contain "1"
    asked should not contain "4"
    asked should not contain "5"
    asked should not contain "6"
    val messages = result.hcursor.downField("messages").as[List[Int]].toOption.get
    List(0, 1, 4, 5, 6).foreach(messages should contain(_))
    messages should not contain 2
    messages should not contain 3

  test("with no anchor and no images only the last unit is protected"):
    val post = Script(body => Right(noul(questionIds(body), 0.9)))
    val inventory = inventoryOf(
      Nil,
      Nil,
      List(message("assistant", "earlier"), message("assistant", "CURRENT-REQUEST"))
    )
    val result = Selector(open, post).select(inventory).futureValue
    questionIds(post.bodies.head) shouldBe List("0")
    result.hcursor.downField("messages").as[List[Int]] shouldBe Right(List(0, 1))

  test("an image unit and the following assistant are one question"):
    val post = Script(body => Right(noul(questionIds(body), 0.49)))
    val inventory = inventoryOf(
      Nil,
      Nil,
      List(
        message("user", "pic", hasImages = true),
        message("assistant", "caption"),
        message("user", "CURRENT-REQUEST")
      )
    )
    val result = Selector(open, post).select(inventory).futureValue
    questionIds(post.bodies.head) shouldBe List("0,1")
    val messages = result.hcursor.downField("messages").as[List[Int]].toOption.get
    messages should not contain 0
    messages should not contain 1
    messages should contain(2)

  test("a lone tool message is kept and is not a question"):
    val post = Script(body => Right(noul(questionIds(body), 0.1)))
    val inventory = inventoryOf(
      Nil,
      Nil,
      List(
        message("tool", "orphan"),
        message("user", "ancient"),
        message("assistant", "a"),
        message("user", "mid"),
        message("user", "CURRENT-REQUEST")
      )
    )
    val result = Selector(open, post).select(inventory).futureValue
    val asked = post.bodies.flatMap(questionIds)
    asked.exists(_.startsWith("0")) shouldBe false
    asked should not contain "0"
    val messages = result.hcursor.downField("messages").as[List[Int]].toOption.get
    messages should contain(0)
    messages should not contain 1
    messages should not contain 2
    messages should contain(4)

  test("a bad response on both calls returns keep and warns once each"):
    val post = Script(_ => Right(Json.obj()))
    val (result, warns) = watched(Selector(open, post).select(wide).futureValue)
    result shouldBe Keep
    warns.map(which) should contain theSameElementsAs List("menu", "history")
    warns.mkString should not include bearer
    warns.mkString should not include "ANCIENT-TURN"

  test("a connection failure on both calls returns keep and warns once each"):
    val post = new JevPost:
      def post(body: Json, bearer: String) = Future.failed(new java.io.IOException("down"))
    val (result, warns) = watched(Selector(open, post).select(wide).futureValue)
    result shouldBe Keep
    warns.map(which) should contain theSameElementsAs List("menu", "history")
    warns.foreach(_.contains("connection failed") shouldBe true)

  test("a hung transport times out each call and returns keep"):
    val post = new JevPost:
      def post(body: Json, bearer: String) = Promise[Either[Fault, Json]]().future
    val (result, warns) = watched(Selector(open, post, timeoutMs = 40).select(wide).futureValue)
    result shouldBe Keep
    warns.map(which) should contain theSameElementsAs List("menu", "history")
    warns.foreach(_.contains("timeout") shouldBe true)
    warns.mkString should not include bearer

  test("an issued request logs info without the key or the inventory"):
    val post = Script(body => Right(noul(questionIds(body), 0.9)))
    val (result, lines) = logged(Selector(open, post).select(wide).futureValue)
    result.hcursor.get[String]("action") shouldBe Right("select")
    lines.exists(_.contains("menu: sent")) shouldBe true
    lines.exists(_.contains("history: sent")) shouldBe true
    lines.exists(_.contains("menu: Jev kept")) shouldBe true
    lines.exists(_.contains("history: Jev kept")) shouldBe true
    lines.exists(_.startsWith("[jev-context] init: rewrite ")) shouldBe true
    lines.mkString should not include bearer
    lines.mkString should not include "ANCIENT-TURN"
    lines.mkString should not include "CURRENT-REQUEST"

  test("a later call sends Jev history questions only and drops an earlier tool round"):
    val post = Script: body =>
      Right(noulPairs(questionIds(body).map(id => id -> (if id == "2,3" then 0.1 else 0.9))))
    val inventory = turnOf(
      List(
        message("user", "OLD-TURN"),
        message("user", "CURRENT-REQUEST"),
        message("assistant", "round-1", tools = List("grep")),
        message("tool", "hit-1"),
        message("assistant", "round-2", tools = List("grep")),
        message("tool", "hit-2")
      ),
      requestAt = 1
    )
    val (result, lines) = logged(Selector(turnOpen, post).select(inventory).futureValue)
    lines.exists(_.contains("turn history: sent 1 question to Jev")) shouldBe true
    lines.exists(_ == "[jev-context] turn: rewrite messages") shouldBe true
    lines.exists(_.contains("init ")) shouldBe false
    post.bodies.size shouldBe 1
    val body = post.bodies.head
    body.hcursor.downField("state").downField("candidates").focus shouldBe None
    questionIds(body) shouldBe List("2,3")
    body.hcursor.downField("state").downField("request").as[String] shouldBe Right("CURRENT-REQUEST")
    body.noSpaces should not include "OLD-TURN"
    body.noSpaces should not include "round-2"
    result.hcursor.downField("tools").focus shouldBe None
    result.hcursor.downField("skills").focus shouldBe None
    result.hcursor.downField("messages").as[List[Int]].toOption.get shouldBe List(0, 1, 4, 5)
    result.hcursor.get[Boolean]("eachTurn") shouldBe Right(true)

  test("a later call keeps an earlier tool round when its score stays"):
    val post = Script(body => Right(noul(questionIds(body), 0.9)))
    val inventory = turnOf(
      List(
        message("user", "CURRENT-REQUEST"),
        message("assistant", "round-1", tools = List("grep")),
        message("tool", "hit-1"),
        message("assistant", "round-2", tools = List("grep")),
        message("tool", "hit-2")
      ),
      requestAt = 0
    )
    val result = Selector(turnOpen, post).select(inventory).futureValue
    questionIds(post.bodies.head) shouldBe List("1,2")
    result.hcursor.downField("messages").as[List[Int]].toOption.get shouldBe List(0, 1, 2, 3, 4)

  test("the latest tool round alone does not call Jev"):
    val post = Script(_ => Left(Fault.Status(500)))
    val inventory = turnOf(
      List(
        message("user", "CURRENT-REQUEST"),
        message("assistant", "round", tools = List("grep")),
        message("tool", "hit")
      ),
      requestAt = 0
    )
    val result = Selector(turnOpen, post).select(inventory).futureValue
    post.bodies shouldBe empty
    result.hcursor.get[String]("action") shouldBe Right("keep")
    result.hcursor.get[Boolean]("eachTurn") shouldBe Right(true)

  test("eachTurn off does not send the later history request"):
    val post = Script(_ => Left(Fault.Status(500)))
    val inventory = turnOf(
      List(
        message("user", "CURRENT-REQUEST"),
        message("assistant", "round-1", tools = List("grep")),
        message("tool", "hit-1"),
        message("assistant", "round-2", tools = List("grep")),
        message("tool", "hit-2")
      ),
      requestAt = 0
    )
    Selector(open, post).select(inventory).futureValue shouldBe Keep
    post.bodies shouldBe empty

  test("a closed main switch does not send the later history request"):
    val post = Script(_ => Left(Fault.Status(500)))
    val doc = Json.obj("jevContext" -> false.asJson, "eachTurn" -> true.asJson, "secretId" -> "s1".asJson)
    val inventory = turnOf(
      List(
        message("user", "CURRENT-REQUEST"),
        message("assistant", "round-1", tools = List("grep")),
        message("tool", "hit-1"),
        message("assistant", "round-2", tools = List("grep")),
        message("tool", "hit-2")
      ),
      requestAt = 0
    )
    Selector(gate(doc, Some(bearer)), post).select(inventory).futureValue shouldBe Keep
    post.bodies shouldBe empty

  test("the first call still sends menu questions when eachTurn is on"):
    val post = Gate()
    val result = Selector(turnOpen, post, timeoutMs = 200).select(wide).futureValue
    post.bodies.size shouldBe 2
    result.hcursor.get[Boolean]("eachTurn") shouldBe Right(true)
    result.hcursor.downField("tools").focus.isDefined shouldBe true

  test("a bad later history response keeps the list"):
    val post = Script(_ => Right(Json.obj()))
    val inventory = turnOf(
      List(
        message("user", "CURRENT-REQUEST"),
        message("assistant", "round-1", tools = List("grep")),
        message("tool", "hit-1"),
        message("assistant", "round-2", tools = List("grep")),
        message("tool", "hit-2")
      ),
      requestAt = 0
    )
    val (result, warns) = watched(Selector(turnOpen, post).select(inventory).futureValue)
    result.hcursor.get[String]("action") shouldBe Right("keep")
    result.hcursor.downField("messages").focus shouldBe None
    result.hcursor.get[Boolean]("eachTurn") shouldBe Right(true)
    warns.map(which) shouldBe List("history")

  test("question text and the question-set version stay pinned"):
    QuestionSetVersion shouldBe 1
    menuInstructions("grep") shouldBe
      "Given the user request and `candidates.grep.description`, does the agent need `candidates.grep` available for this request?"
    historyInstructions("2,3") shouldBe
      "Given the current user request, is `history.2,3` still needed to respond? `history.2,3` is prior conversation, a prior tool call, or a prior tool result."
    Model shouldBe "jev-1.13.0"
    Endpoint shouldBe "https://api.typesafe.ai/v1/systemone"

  private def open: Settings = gate(Json.obj("jevContext" -> true.asJson, "secretId" -> "s1".asJson), Some(bearer))

  private def turnOpen: Settings =
    gate(Json.obj("jevContext" -> true.asJson, "eachTurn" -> true.asJson, "secretId" -> "s1".asJson), Some(bearer))

  private def turnOf(messages: List[Json], requestAt: Int): Json =
    inventoryOf(Nil, Nil, messages).deepMerge(Json.obj("pass" -> "turn".asJson, "request" -> requestAt.asJson))

  private def gate(doc: Json, plain: Option[String]): Settings = new Settings:
    def current() = Future.successful(doc)
    def secret(id: String) = Future.successful(plain)

  private def message(
      role: String,
      content: String,
      synthetic: Boolean = false,
      hasImages: Boolean = false,
      tools: List[String] = Nil
  ): Json =
    Json.obj(
      "role" -> role.asJson,
      "content" -> content.asJson,
      "synthetic" -> synthetic.asJson,
      "hasImages" -> hasImages.asJson,
      "toolCalls" -> tools.map(name => Json.obj("name" -> name.asJson)).asJson
    )

  private def inventoryOf(
      tools: List[(String, String)],
      skills: List[(String, String)],
      messages: List[Json]
  ): Json =
    Json.obj(
      "current" -> (messages.length - 1).asJson,
      "tools" -> tools.map((id, description) => Json.obj(
        "id" -> id.asJson,
        "kind" -> "builtin".asJson,
        "description" -> description.asJson
      )).asJson,
      "skills" -> skills.map((name, description) => Json.obj(
        "name" -> name.asJson,
        "description" -> description.asJson
      )).asJson,
      "messages" -> messages.asJson
    )

  private def onlyCurrent: Json =
    inventoryOf(List("read_file" -> "resident"), Nil, List(message("user", "CURRENT-REQUEST")))

  private val wideTools =
    List("read_file" -> "resident", "keep-tool" -> "TOOL-DESC", "drop-tool" -> "TOOL-DESC")
      ++ (1 to 7).map(i => s"filler-$i" -> "TOOL-DESC")

  private val wideSkills = List("keep-skill" -> "SKILL-DESC", "drop-skill" -> "SKILL-DESC")

  private def wide: Json =
    inventoryOf(
      wideTools,
      wideSkills,
      List(
        message("user", "ANCIENT-TURN"),
        message("assistant", "old-reply"),
        message("user", "MID-TURN"),
        message("user", "CURRENT-REQUEST")
      )
    )

  private def wideCurrent: Int = 3

  private def questionIds(body: Json): List[String] =
    body.hcursor.downField("questions").focus.flatMap(_.asObject).map(_.keys.toList).getOrElse(Nil)

  private def noul(ids: List[String], p: Double): Json =
    noulPairs(ids.map(_ -> p))

  private def noulPairs(scores: List[(String, Double)]): Json =
    Json.obj("answers" -> Json.obj(scores.map((id, p) =>
      id -> Json.obj("type" -> "noul".asJson, "noul" -> p.asJson)
    )*))

  private def which(line: String): String =
    if line.contains("menu") then "menu"
    else if line.contains("history") then "history"
    else line

  private def logged[T](body: => T): (T, List[String]) =
    captured(ch.qos.logback.classic.Level.INFO, body)

  private def watched[T](body: => T): (T, List[String]) =
    captured(ch.qos.logback.classic.Level.WARN, body)

  private def captured[T](level: ch.qos.logback.classic.Level, body: => T): (T, List[String]) =
    val logger = LoggerFactory.getLogger("ai.fastllm.agent.jev.Select").asInstanceOf[Logger]
    val prev = logger.getLevel
    val buf = ListAppender[ILoggingEvent]()
    buf.start()
    logger.setLevel(level)
    logger.addAppender(buf)
    val result =
      try body
      finally
        logger.detachAppender(buf)
        logger.setLevel(prev)
    (result, buf.list.asScala.toList.map(_.getFormattedMessage))

final class Script(reply: Json => Either[Fault, Json]) extends JevPost:
  val bodies = ListBuffer.empty[Json]
  def post(body: Json, bearer: String): Future[Either[Fault, Json]] =
    bodies += body
    Future.successful(reply(body))

final class Gate extends JevPost:
  val bodies = new ConcurrentLinkedQueue[Json]()
  val bearers = new ConcurrentLinkedQueue[String]()
  private val release = Promise[Unit]()

  def post(body: Json, bearer: String): Future[Either[Fault, Json]] =
    bodies.add(body)
    bearers.add(bearer)
    if bodies.size >= 2 then release.trySuccess(())
    release.future.map { _ =>
      Right(Json.obj("answers" -> Json.obj(
        body.hcursor.downField("questions").focus.flatMap(_.asObject).toList.flatMap(_.toList).map((id, _) =>
          id -> Json.obj("type" -> "noul".asJson, "noul" -> 0.9.asJson)
        )*
      )))
    }(using ExecutionContext.parasitic)
