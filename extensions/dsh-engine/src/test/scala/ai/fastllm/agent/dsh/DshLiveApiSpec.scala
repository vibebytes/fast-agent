package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.{Admit, AgentAttachProtocol, EventRow}
import ai.fastllm.agent.remote.Client
import io.circe.Json
import io.circe.parser.parse
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.*
import scala.concurrent.{Await, Future}
import scala.jdk.CollectionConverters.*

/**
 * Hits a real DSH web (`settings.describe` / `agentPreset.list`). Fake HttpServer is not enough.
 * No live process and no FAST_DSH_* → cancel (not silent green). Explicit env and down → fail.
 */
class DshLiveApiSpec extends AnyFunSuite with Matchers:

  test("DshHttp settings.describe returns live DSH namespaces"):
    val live = LiveDsh.open
    try
      val remote = live.http()
      try
        val json = await(remote.call("settings.describe", Json.obj()))
        json.hcursor.get[Boolean]("ok").toOption.get shouldBe true
        val ns = namespaces(json)
        ns should contain("permission")
        ns should contain("agent-presets")
        ns should contain("locale")
      finally remote.close()
    finally live.close()

  test("DshFace settings.describe does not wait for mux and keeps live value"):
    val live = LiveDsh.open
    try
      val remote = live.http(muxReadySec = 1)
      val face = DshFace(remote, _ => "/tmp", DshLoop(remote, _ => "/tmp"))
      val json = await(face.dispatch("settings.describe", Json.obj(), None))
      json.hcursor.get[Boolean]("ok").toOption.get shouldBe true
      val value = json.hcursor.downField("value")
      value.get[Boolean]("writable").toOption shouldBe defined
      namespaces(json) should contain("permission")
    finally live.close()

  test("DshHttp + DshLoop bind then prompt paints checkpoint and RunCompleted"):
    val live = LiveDsh.open
    val http = live.http()
    val mux = java.util.concurrent.ConcurrentLinkedQueue[Json]()
    val remote = LiveMuxTee(http, mux.add)
    val cwd = java.nio.file.Files.createTempDirectory("dsh-who-")
    val sid = s"live-who-${java.util.UUID.randomUUID()}"
    val loop = DshLoop(remote, _ => cwd.toString)
    try
      await(http.ready)
      await(loop.bind(sid, cwd.toString)).isRight shouldBe true
      Thread.sleep(400)
      await(loop.submit(AgentAttachProtocol.Command.SubmitUserMessage(sid, "c1", "只回复一字：好"))) shouldBe
        Admit.Accepted(s"$sid:c1")
      val deadline = System.currentTimeMillis() + 45_000
      var rows = await(loop.events(sid, 0))
      while System.currentTimeMillis() < deadline && !settled(rows) do
        Thread.sleep(200)
        rows = await(loop.events(sid, 0))
      val types = mux.asScala.flatMap: raw =>
        muxOf(raw).collect:
          case Mux.Event(s, ev) if s == sid => ev.hcursor.get[String]("type").toOption.getOrElse("?")
      .toList
      val clue =
        s"""live who sid=$sid
           |river=${rows.filter(_.seq > 0).map(r => payloadType(r))}
           |muxTypes=$types
           |""".stripMargin
      val painted = rows.exists: r =>
        val t = payloadType(r)
        (t == "CheckpointEvent" || t == "AssistantDelta") &&
          payloadString(r, if t == "CheckpointEvent" then "content" else "text").nonEmpty
      withClue(clue):
        settled(rows) shouldBe true
        painted shouldBe true
    finally
      http.close()
      live.close()

  test("DshHttp agentPreset.list returns live presets"):
    val live = LiveDsh.open
    try
      val remote = live.http()
      try
        val json = await(remote.call("agentPreset.list", Json.obj()))
        json.hcursor.get[Boolean]("ok").toOption.get shouldBe true
        val ids = json.hcursor.downField("value").downField("presets").values
          .getOrElse(Vector.empty)
          .flatMap(_.hcursor.get[String]("id").toOption)
        ids should contain("minimal")
      finally remote.close()
    finally live.close()

  private def namespaces(json: Json): Vector[String] =
    json.hcursor.downField("value").downField("namespaces").values
      .getOrElse(Vector.empty)
      .flatMap(_.hcursor.get[String]("ns").toOption)
      .toVector

  private def settled(rows: List[EventRow]): Boolean =
    rows.exists(r => payloadType(r) == "RunCompleted")

  private def payloadType(row: EventRow): String =
    parse(row.envelopeJson).toOption.flatMap(_.hcursor.downField("payload").get[String]("type").toOption).getOrElse("")

  private def payloadString(row: EventRow, field: String): String =
    parse(row.envelopeJson).toOption.flatMap(_.hcursor.downField("payload").get[String](field).toOption).getOrElse("")

  private def await[A](f: Future[A]): A = Await.result(f, 20.seconds)

private final class LiveMuxTee(inner: Client, onMux: Json => Unit) extends Client:
  def call(method: String, payload: Json): Future[Json] = inner.call(method, payload)
  def reply(rpcId: String, value: Json): Future[Unit] = inner.reply(rpcId, value)
  override def replyCancel(rpcId: String): Future[Unit] = inner.replyCancel(rpcId)
  def listen(channel: String)(emit: Json => Unit): Unit =
    if channel == "mux" then inner.listen(channel)(j => { onMux(j); emit(j) })
    else inner.listen(channel)(emit)
  def ready: Future[Unit] = inner.ready
  def close(): Unit = inner.close()
