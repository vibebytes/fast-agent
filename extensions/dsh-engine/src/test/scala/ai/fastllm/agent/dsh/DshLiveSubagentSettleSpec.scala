package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.{Admit, AgentAttachProtocol, EventRow}
import ai.fastllm.agent.dsh.http.DshHttp
import ai.fastllm.agent.remote.Client
import io.circe.Json
import io.circe.parser.parse
import io.circe.syntax.*
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.nio.file.Files
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.*
import scala.concurrent.{Await, Future}
import scala.jdk.CollectionConverters.*
import scala.util.control.NonFatal

/** Live DSH: replay the settled continuable that Fast-IDE left 「运行中」, then watch a new one on mux. */
class DshLiveSubagentSettleSpec extends AnyFunSuite with Matchers:

  private val KnownChild = "7fca9434-9310-480a-80f8-04ec8fb0e935"
  private val Keep =
    Set("turn/start", "turn/end", "tool/call", "user/message", "subagent/descriptor")

  test("replay settled continuable: DshLoop card goes inactive"):
    val taped = liveKnown().getOrElse(fixtureTape())
    val fake = FakeClient()
    val loop = DshLoop(fake, _ => "/tmp/dsh-replay")
    await(loop.submit(AgentAttachProtocol.Command.SubmitUserMessage(taped.parent, "c1", "hi"))) shouldBe
      Admit.Accepted(s"${taped.parent}:c1")
    fake.list = catalogJson(taped.child, "running", taped.mode, taped.label)
    replay(fake, taped.parent, taped.child, taped.parentEvs, taped.childEvs)
    fake.list = catalogJson(taped.child, taped.listActivity, taped.mode, taped.label)
    fake.emitSubscribed(taped.parent, 0)

    val updated = await(loop.events(taped.parent, 0)).filter(r => payloadType(r) == "SubagentUpdated")
    val lastActivity = updated.lastOption.map(r => payloadString(r, "activity")).getOrElse("missing")
    val parentSources = taped.parentEvs.flatMap(sourceKind)
    val childTurnEnd = taped.childEvs.exists(e => tpe(e) == "turn/end")
    val clue =
      s"""replay src=${taped.src} ${taped.parent} / ${taped.child}
         |catalog activity=${taped.listActivity} mode=${taped.mode}
         |parent sources=$parentSources child turn/end=$childTurnEnd
         |DshLoop activities=${updated.map(r => payloadString(r, "activity"))}
         |last=$lastActivity childOpen=${loop.childOpen(taped.parent)}
         |""".stripMargin
    withClue(clue):
      childTurnEnd shouldBe true
      parentSources should contain("subagent-settled")
      taped.listActivity shouldBe "inactive"
      lastActivity shouldBe "inactive"
      loop.childOpen(taped.parent) shouldBe false

  test("live mux: after child turn/end DshLoop must leave 运行中"):
    val live = LiveDsh.open
    val http = DshHttp(Future.successful(live.port))
    val mux = ConcurrentLinkedQueue[Json]()
    val remote = TeeClient(http, mux.add)
    val cwd = Files.createTempDirectory("dsh-settle-")
    Files.writeString(cwd.resolve("ping.txt"), "PONG")
    val sid = s"live-settle-${UUID.randomUUID()}"
    val loop = DshLoop(remote, _ => cwd.toString)
    try
      await(http.ready)
      await(loop.bind(sid, cwd.toString)).isRight shouldBe true
      val prompt =
        "必须调用 subagent 工具（可续跑后台，不要用 subagent_fork）。子任务：只读取工作目录 ping.txt，把内容通过 report 回报后结束。你自己不要读文件。收到 report 或 settlement 后只回复 DONE。"
      await(loop.submit(AgentAttachProtocol.Command.SubmitUserMessage(sid, "c1", prompt))) shouldBe
        Admit.Accepted(s"$sid:c1")
      val deadline = System.currentTimeMillis() + 180_000
      var childSid = Option.empty[String]
      var muxChildEnd = false
      var muxSettled = false
      while System.currentTimeMillis() < deadline && !(muxChildEnd && !loop.childOpen(sid)) do
        drainApprovals(loop, sid)
        mux.asScala.foreach: raw =>
          muxOf(raw).foreach:
            case Mux.Event(s, ev) =>
              val t = ev.hcursor.get[String]("type").toOption.getOrElse("")
              if s != sid && t == "turn/start" then childSid = Some(s)
              if childSid.contains(s) && t == "turn/end" then muxChildEnd = true
              if s == sid && sourceKind(ev).contains("subagent-settled") then muxSettled = true
            case _ => ()
        Thread.sleep(200)
      val updated = await(loop.events(sid, 0)).filter(r => payloadType(r) == "SubagentUpdated")
      val lastActivity = updated.lastOption.map(r => payloadString(r, "activity")).getOrElse("missing")
      val types = mux.asScala.flatMap: raw =>
        muxOf(raw).collect:
          case Mux.Event(s, ev) =>
            s"${if s == sid then "P" else "C"}:${ev.hcursor.get[String]("type").toOption.getOrElse("?")}"
      .toList
      val clue =
        s"""live mux sid=$sid child=$childSid
           |muxChildEnd=$muxChildEnd muxSettled=$muxSettled
           |last=$lastActivity childOpen=${loop.childOpen(sid)}
           |activities=${updated.map(r => payloadString(r, "activity"))}
           |muxTypes=$types
           |""".stripMargin
      withClue(clue):
        (muxChildEnd || muxSettled) shouldBe true
        lastActivity shouldBe "inactive"
        loop.childOpen(sid) shouldBe false
    finally
      http.close()
      live.close()

  private def liveKnown(): Option[Tape] =
    LiveDsh.attachExisting.flatMap: live =>
      val http = DshHttp(Future.successful(live.port))
      try
        await(http.ready)
        val items = value(await(http.call("session.list", Json.obj())))
          .hcursor.downField("items").as[List[Json]].toOption.getOrElse(Nil)
        items.find(s => sidOf(s).contains(KnownChild)).flatMap: childItem =>
          val childSid = sidOf(childItem).get
          childItem.hcursor.get[String]("parentSessionId").toOption.filter(_.nonEmpty).map: parentSid =>
            val catalog = await(http.call("subagent.list", Json.obj("parentSessionId" -> parentSid.asJson)))
            val entry = childrenOf(catalog).find(_.hcursor.get[String]("id").toOption.contains(childSid))
            Tape(
              "live",
              parentSid,
              childSid,
              history(http, parentSid),
              history(http, childSid),
              entry.flatMap(_.hcursor.get[String]("activity").toOption).getOrElse("inactive"),
              entry.flatMap(_.hcursor.get[String]("mode").toOption).getOrElse("continuable"),
              entry.flatMap(_.hcursor.get[String]("label").toOption).getOrElse("scan")
            )
      catch
        case NonFatal(_) => None
      finally http.close()

  private def fixtureTape(): Tape =
    Tape(
      "fixture",
      "parent-settle-1",
      "child-settle-1",
      loadJsonl("settle-parent.jsonl"),
      loadJsonl("settle-child.jsonl"),
      "inactive",
      "continuable",
      "scan"
    )

  private def loadJsonl(name: String): List[Json] =
    val src = scala.io.Source.fromResource(s"dsh/$name")
    try
      src.getLines().map(_.trim).filter(_.nonEmpty).map: line =>
        parse(line).fold(e => fail(s"$name: $e"), identity)
      .toList
    finally src.close()

  private def replay(
      fake: FakeClient,
      parent: String,
      child: String,
      parentEvs: List[Json],
      childEvs: List[Json]
  ): Unit =
    val parentFrames = parentEvs.filter(e => Keep(tpe(e))).map(e => Timed(timeOf(e), parent, e))
    val childFrames = childEvs.filter(e => Keep(tpe(e))).map(e => Timed(timeOf(e), child, e))
    (parentFrames ++ childFrames).sortBy(_.time).foreach: f =>
      if f.sid == parent && tpe(f.ev) == "tool/call" then
        val name = f.ev.hcursor.downField("data").get[String]("name").toOption.getOrElse("")
        if name == "subagent" || name == "subagent_fork" then fake.emitSubscribed(parent, 0)
      fake.emit(f.sid, f.ev)

  private def history(http: DshHttp, sessionId: String): List[Json] =
    val json = await(http.call("session.history", Json.obj("sessionId" -> sessionId.asJson, "maxMessages" -> Json.fromInt(50))))
    value(json).hcursor.downField("events").as[List[Json]].toOption.getOrElse(Nil).map: item =>
      item.hcursor.downField("event").focus.getOrElse(item)

  private def childrenOf(json: Json): List[Json] =
    value(json).hcursor.downField("entries").as[List[Json]].toOption.getOrElse(Nil)

  private def catalogJson(id: String, activity: String, mode: String, label: String): Json =
    Json.obj(
      "ok" -> Json.True,
      "value" -> Json.obj(
        "entries" -> Json.arr(
          Json.obj(
            "kind" -> "child".asJson,
            "id" -> id.asJson,
            "activity" -> activity.asJson,
            "mode" -> mode.asJson,
            "label" -> label.asJson
          )
        ),
        "parentAvailable" -> Json.True
      )
    )

  private def drainApprovals(loop: DshLoop, sessionId: String): Unit =
    await(loop.events(sessionId, 0)).foreach: row =>
      if payloadType(row) == "ApprovalRequested" then
        val id = payloadString(row, "approvalId")
        val run = payloadString(row, "runId")
        if id.nonEmpty then
          try
            await(loop.decide(AgentAttachProtocol.Command.DecideApproval(sessionId, run, id, approved = true)))
          catch case NonFatal(_) => ()

  private def value(json: Json): Json =
    json.hcursor.get[Boolean]("ok") match
      case Right(false) =>
        fail(json.hcursor.downField("error").get[String]("code").toOption.getOrElse(json.noSpaces))
      case _ =>
        json.hcursor.downField("value").focus.getOrElse(json)

  private def sidOf(item: Json): Option[String] =
    item.hcursor.get[String]("sessionId").toOption.orElse(item.hcursor.get[String]("id").toOption)

  private def tpe(ev: Json): String = ev.hcursor.get[String]("type").toOption.getOrElse("")
  private def timeOf(ev: Json): Long = ev.hcursor.get[Long]("time").toOption.getOrElse(0L)
  private def sourceKind(ev: Json): Option[String] =
    if tpe(ev) != "user/message" then None
    else ev.hcursor.downField("data").downField("source").get[String]("kind").toOption

  private def payloadType(row: EventRow): String =
    parse(row.envelopeJson).toOption.flatMap(_.hcursor.downField("payload").get[String]("type").toOption).getOrElse("")

  private def payloadString(row: EventRow, field: String): String =
    parse(row.envelopeJson).toOption.flatMap(_.hcursor.downField("payload").get[String](field).toOption).getOrElse("")

  private def await[A](f: Future[A]): A = Await.result(f, 30.seconds)

private final case class Tape(
    src: String,
    parent: String,
    child: String,
    parentEvs: List[Json],
    childEvs: List[Json],
    listActivity: String,
    mode: String,
    label: String
)

private final case class Timed(time: Long, sid: String, ev: Json)

private final class TeeClient(inner: Client, onMux: Json => Unit) extends Client:
  def call(method: String, payload: Json): Future[Json] = inner.call(method, payload)
  def reply(rpcId: String, value: Json): Future[Unit] = inner.reply(rpcId, value)
  override def replyCancel(rpcId: String): Future[Unit] = inner.replyCancel(rpcId)
  def listen(channel: String)(emit: Json => Unit): Unit =
    if channel == "mux" then inner.listen(channel)(j => { onMux(j); emit(j) })
    else inner.listen(channel)(emit)
  def ready: Future[Unit] = inner.ready
  def close(): Unit = inner.close()
