package ai.fastllm.agent.dsh.http

import ai.fastllm.agent.remote.Client
import io.circe.Json
import io.circe.syntax.*

import org.slf4j.LoggerFactory

import java.net.URI
import java.net.http.{HttpClient, HttpRequest, HttpResponse, WebSocket}
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.UUID
import java.util.concurrent.{CompletableFuture, CompletionStage, TimeUnit}
import java.util.concurrent.atomic.AtomicBoolean
import scala.concurrent.{ExecutionContext, Future, Promise}
import scala.jdk.FutureConverters.*
import scala.util.control.NonFatal

val UnaryMethods: Set[String] =
  Set(
    "host.describe",
    "session.create",
    "session.prompt",
    "session.cancel",
    "session.history",
    "session.models",
    "session.selectModel",
    "session.list",
    "session.updateQueue",
    "session.attachment",
    "subagent.list",
    "subagent.history",
    "subagent.prompt",
    "subagent.interrupt",
    "goal.create",
    "goal.edit",
    "goal.pause",
    "goal.resume",
    "goal.complete",
    "goal.clear",
    "skill.list",
    "settings.describe",
    "settings.openDocument",
    "settings.update",
    "settings.replace",
    "settings.mutate",
    "credentials.describe",
    "credentials.set",
    "credentials.unset",
    "llm.providers",
    "llm.models",
    "llm.discoverModels",
    "agentPreset.list",
    "agentPreset.select",
    "agentPreset.read",
    "agentPreset.copy",
    "agentPreset.openDocument",
    "agentPreset.remove",
    "pluginInventory.list"
  )

def unaryEnvelope(method: String, payload: Json): Json =
  Json.obj(
    "type" -> "client-request".asJson,
    "rpcId" -> UUID.randomUUID().toString.asJson,
    "method" -> method.asJson,
    "payload" -> payload
  )

def peel(status: Int, body: Json): Json =
  if status >= 400 then Json.obj("ok" -> Json.False, "error" -> Json.obj("code" -> "internal".asJson))
  else
    body.hcursor.downField("result").focus match
      case Some(result) =>
        result.hcursor.get[Boolean]("ok") match
          case Right(false) =>
            val err = result.hcursor.downField("error").focus.getOrElse(Json.obj("code" -> "internal".asJson))
            Json.obj("ok" -> Json.False, "error" -> err)
          case _ =>
            Json.obj("ok" -> Json.True, "value" -> result.hcursor.downField("value").focus.getOrElse(Json.obj()))
      case None =>
        body.hcursor.get[Boolean]("ok") match
          case Right(false) => body
          case _            => Json.obj("ok" -> Json.True, "value" -> body.hcursor.downField("value").focus.getOrElse(body))

def muxFrame(raw: Json): Json =
  raw.hcursor.get[String]("type").toOption match
    case Some("server-request") => raw.hcursor.downField("payload").focus.getOrElse(raw)
    case _                      => raw

/** Host `/api` over loopback HTTP + mux WebSocket. Completions hop onto `ec`. */
class DshHttp(portOf: Future[Int], muxReadySec: Long = 5)(using ec: ExecutionContext) extends Client:
  private lazy val log = LoggerFactory.getLogger(getClass)
  private val http = HttpClient.newBuilder()
    .version(HttpClient.Version.HTTP_1_1)
    .connectTimeout(Duration.ofSeconds(5))
    .executor(r => ec.execute(r))
    .build()
  private val stopped = AtomicBoolean(false)
  private val muxOpening = AtomicBoolean(false)
  private val muxOpen = Promise[Unit]()
  @volatile private var emitMux: Json => Unit = _ => ()
  @volatile private var emitHost: Json => Unit = _ => ()
  @volatile private var socket: Option[WebSocket] = None
  @volatile private var hostSocket: Option[WebSocket] = None

  def call(method: String, payload: Json): Future[Json] =
    if !UnaryMethods.contains(method) then
      Future.successful(Json.obj("ok" -> Json.False, "error" -> Json.obj("code" -> "internal".asJson)))
    else
      portOf.flatMap: port =>
        val body = unaryEnvelope(method, payload).noSpaces
        val req = HttpRequest.newBuilder()
          .uri(URI.create(s"http://127.0.0.1:$port/api/$method"))
          .timeout(Duration.ofSeconds(30))
          .header("Content-Type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
          .build()
        http.sendAsync(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).asScala
          .map: res =>
            val json = io.circe.parser.parse(res.body()).getOrElse(Json.obj())
            peel(res.statusCode(), json)
          .recover:
            case NonFatal(e) =>
              log.warn(s"dsh unary $method: ${e.getClass.getSimpleName}: ${e.getMessage}")
              Json.obj("ok" -> Json.False, "error" -> Json.obj("code" -> "internal".asJson))

  def reply(rpcId: String, value: Json): Future[Unit] =
    respond(rpcId, Json.obj("ok" -> Json.True, "value" -> value))

  override def replyCancel(rpcId: String): Future[Unit] =
    respond(rpcId, Json.obj("ok" -> Json.False, "error" -> Json.obj("code" -> "cancelled".asJson)))

  private def respond(rpcId: String, result: Json): Future[Unit] =
    portOf.flatMap: port =>
      val body = Json.obj(
        "type" -> "client-response".asJson,
        "rpcId" -> rpcId.asJson,
        "result" -> result
      ).noSpaces
      val req = HttpRequest.newBuilder()
        .uri(URI.create(s"http://127.0.0.1:$port/api/respond"))
        .timeout(Duration.ofSeconds(30))
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
        .build()
      http.sendAsync(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).asScala.flatMap: res =>
        val json = io.circe.parser.parse(res.body()).getOrElse(Json.obj())
        val peeled = peel(res.statusCode(), json)
        peeled.hcursor.get[Boolean]("ok") match
          case Right(false) =>
            val code = peeled.hcursor.downField("error").get[String]("code").toOption.getOrElse("internal")
            Future.failed(RuntimeException(code))
          case _ =>
            peeled.hcursor.downField("value").get[Boolean]("accepted") match
              case Right(false) =>
                val reason =
                  peeled.hcursor.downField("value").get[String]("reason").toOption.getOrElse("not-pending")
                Future.failed(RuntimeException(reason))
              case _ => Future.unit

  def listen(channel: String)(emit: Json => Unit): Unit =
    channel match
      case "mux"  => emitMux = emit
      case "host" => emitHost = emit
      case _      => ()

  def ready: Future[Unit] =
    if muxOpen.isCompleted then muxOpen.future
    else
      log.info("dsh ready: host.describe")
      call("host.describe", Json.obj()).flatMap: json =>
        json.hcursor.get[Boolean]("ok") match
          case Right(false) =>
            val code = json.hcursor.downField("error").get[String]("code").toOption.getOrElse("internal")
            Future.failed(RuntimeException(s"dsh host.describe: $code"))
          case _ =>
            openMux()
            val cf = new CompletableFuture[Void]()
            muxOpen.future.onComplete:
              case scala.util.Success(_) => cf.complete(null)
              case scala.util.Failure(e) => cf.completeExceptionally(e)
            cf.orTimeout(muxReadySec, TimeUnit.SECONDS).asScala.map(_ => ())
              .recoverWith:
                case NonFatal(e) => Future.failed(RuntimeException(s"dsh mux: ${e.getMessage}", e))

  def close(): Unit =
    stopped.set(true)
    (socket.toList ++ hostSocket.toList).foreach: ws =>
      try ws.sendClose(WebSocket.NORMAL_CLOSURE, "close").join()
      catch case NonFatal(_) => ()
    socket = None
    hostSocket = None

  private def openMux(): Unit =
    if stopped.get() || socket.isDefined || !muxOpening.compareAndSet(false, true) then ()
    else
      portOf.foreach: port =>
        if stopped.get() then muxOpening.set(false)
        else
          http.newWebSocketBuilder()
            .buildAsync(URI.create(s"ws://127.0.0.1:$port/api/events.mux"), MuxListen())
            .whenComplete: (ws, err) =>
              muxOpening.set(false)
              if err != null then
                log.warn(s"dsh mux handshake: ${err.getMessage}")
                if stopped.get() then muxOpen.tryFailure(err)
                else reopen()
              else
                log.info("dsh mux open")
                socket = Some(ws)
                muxOpen.trySuccess(())
                openHost(port)

  private def reopen(): Unit =
    if stopped.get() then ()
    else
      call("host.describe", Json.obj()).foreach(_ => openMux())

  private def reopenHost(): Unit =
    if stopped.get() then ()
    else
      call("host.describe", Json.obj()).foreach(_ => portOf.foreach(openHost))

  private def openHost(port: Int): Unit =
    if stopped.get() || hostSocket.isDefined then ()
    else
      http.newWebSocketBuilder()
        .buildAsync(URI.create(s"ws://127.0.0.1:$port/api/events.host"), HostListen())
        .whenComplete: (ws, err) =>
          if err != null then
            log.warn(s"dsh host handshake: ${err.getMessage}")
            if !stopped.get() then reopenHost()
          else if !stopped.get() then
            log.info("dsh host open")
            hostSocket = Some(ws)

  private class HostListen extends WebSocket.Listener:
    private val buf = StringBuilder()

    override def onOpen(ws: WebSocket): Unit =
      ws.request(1)

    override def onText(ws: WebSocket, data: CharSequence, last: Boolean): CompletionStage[?] =
      buf.append(data)
      if last then
        val text = buf.toString
        buf.clear()
        io.circe.parser.parse(text).toOption.foreach: json =>
          ec.execute(() => emitHost(json))
      ws.request(1)
      null

    override def onClose(ws: WebSocket, status: Int, reason: String): CompletionStage[?] =
      hostSocket = None
      if !stopped.get() then reopenHost()
      null

    override def onError(ws: WebSocket, error: Throwable): Unit =
      hostSocket = None
      if !stopped.get() then reopenHost()

  private class MuxListen extends WebSocket.Listener:
    private val buf = StringBuilder()

    override def onOpen(ws: WebSocket): Unit =
      muxOpen.trySuccess(())
      ws.request(1)

    override def onText(ws: WebSocket, data: CharSequence, last: Boolean): CompletionStage[?] =
      buf.append(data)
      if last then
        val text = buf.toString
        buf.clear()
        io.circe.parser.parse(text).toOption.foreach: json =>
          ec.execute(() => emitMux(json))
      ws.request(1)
      null

    override def onClose(ws: WebSocket, status: Int, reason: String): CompletionStage[?] =
      socket = None
      if !stopped.get() then reopen()
      null

    override def onError(ws: WebSocket, error: Throwable): Unit =
      if !stopped.get() then reopen()
