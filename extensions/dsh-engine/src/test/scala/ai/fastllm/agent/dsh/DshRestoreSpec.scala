package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.MessageType
import io.circe.Json
import io.circe.parser.parse
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import scala.io.Source

class DshRestoreSpec extends AnyFunSuite with Matchers:

  private val Sid = "sess-1"

  test("text turn: user + assistant once; deltas collapse into assistant/message"):
    val hist = dshHistory(Sid, load("text-turn.jsonl"))
    hist.rows.map(r => (r.role, r.messageType, r.content.getOrElse(""))) shouldBe List(
      ("user", "text", "hi"),
      ("assistant", "reasoning", "think"),
      ("assistant", "text", "Hello")
    )
    hist.title shouldBe None

  test("tool pair: call args flatten; result status success"):
    val rows = dshHistory(Sid, load("restore-tools.jsonl")).rows
    rows.map(_.role) shouldBe List("user", "assistant", "tool", "assistant")
    rows(1).payloadJson.get should include("call-1")
    rows(1).payloadJson.get should include("shell")
    rows(1).payloadJson.get should include("ls")
    rows(2).toolCallId shouldBe Some("call-1")
    rows(2).status shouldBe Some("success")
    rows(2).content shouldBe Some("a.txt")
    rows(3).content shouldBe Some("one file")

  test("last todo/write with no following turn/start becomes a Plan row"):
    val hist = dshHistory(Sid, load("restore-todo-open.jsonl"))
    hist.rows.last.messageType shouldBe MessageType.text(MessageType.Plan)
    hist.rows.last.id shouldBe s"dsh-todo:$Sid"
    hist.rows.last.payloadJson.get should include("read the file")
    hist.rows.last.payloadJson.get should include("write tests")
    hist.title shouldBe Some("Fix the parser")

  test("todo/write then turn/start is not restored as Plan"):
    val hist = dshHistory(Sid, load("restore-todo-cleared.jsonl"))
    hist.rows.map(_.messageType) should not contain "plan"
    hist.rows.map(_.content.getOrElse("")) should contain("go")

  test("compaction events are not restored; title stays out of the river"):
    val hist = dshHistory(Sid, load("restore-compaction.jsonl"))
    hist.rows.map(_.messageType) should not contain "compaction"
    hist.rows.map(_.content.getOrElse("")) shouldBe List("hi", "Hello")
    hist.title shouldBe Some("Fix the parser")
    hist.lastSeq shouldBe Some(11L)

  test("history value peels entry.event"):
    val inner = load("text-turn.jsonl").head
    val value = parse(s"""{"events":[{"event":${inner.noSpaces},"view":{"for":"call","view":{"card":"x"}}}],"hasMore":false}""").toOption.get
    historyEvents(value) shouldBe List(inner)

  test("window keeps the latest user turns; beforeTurnId pages older"):
    val rows = (1 to 3).toList.flatMap: n =>
      List(
        row(s"u$n", "user", s"q$n"),
        row(s"a$n", "assistant", s"a$n")
      )
    val latest = dshWindow(rows, None, 2)
    latest.totalExchangeCount shouldBe 3
    latest.hasMoreOlder shouldBe true
    latest.rows.map(_.id) shouldBe List("u2", "a2", "u3", "a3")
    val older = dshWindow(rows, Some("u3"), 1)
    older.rows.map(_.id) shouldBe List("u2", "a2")
    older.hasMoreOlder shouldBe true

  test("parent ChannelMessage stays linear; no nested child fields"):
    val names = ai.fastllm.agent.channel.ChannelMessage("id", Sid, "user", "text").productElementNames.toList
    names shouldBe List(
      "id",
      "sessionId",
      "role",
      "messageType",
      "content",
      "payloadJson",
      "createdAt",
      "turnId",
      "turnNo",
      "runId",
      "agentId",
      "toolCallId",
      "toolName",
      "status",
      "messageOrigin"
    )
    names.exists(n => n.contains("child") || n.contains("nested")) shouldBe false

  test("empty log is an empty window"):
    val hist = dshHistory(Sid, Nil)
    hist.rows shouldBe Nil
    dshWindow(Nil, None, 20) shouldBe ai.fastllm.agent.channel.ChannelMessageWindow(Nil, false, 0)

  private def row(id: String, role: String, text: String) =
    ai.fastllm.agent.channel.ChannelMessage(id, Sid, role, "text", content = Some(text))

  private def load(name: String): List[Json] =
    val src = Source.fromResource(s"dsh/$name")
    try
      src.getLines().map(_.trim).filter(_.nonEmpty).map: line =>
        parse(line).fold(e => fail(s"$name: $e"), identity)
      .toList
    finally src.close()
