package ai.fastllm.agent.dsh.http

import ai.fastllm.agent.remote.Client
import io.circe.Json
import io.circe.syntax.*

import org.slf4j.LoggerFactory

import java.net.{CookieManager, URI}
import java.net.http.{HttpClient, HttpRequest, HttpResponse, WebSocket}
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.concurrent.{CompletableFuture, CompletionStage, ConcurrentHashMap, TimeUnit}
import java.util.concurrent.atomic.AtomicBoolean
import scala.concurrent.{ExecutionContext, Future, Promise}
import scala.jdk.CollectionConverters.*
import scala.jdk.FutureConverters.*
import scala.util.control.NonFatal

/** Host `/api` over Connection / Typert Remote. Completions hop onto `ec`. */
class DshHttp(
    portOf: Future[Int],
    muxReadySec: Long = 5,
    tokenOf: Future[Option[String]] = Future.successful(None)
)(using ec: ExecutionContext) extends Client:
  private lazy val log = LoggerFactory.getLogger(getClass)
  private val cookies = CookieManager()
  private val http = HttpClient.newBuilder()
    .version(HttpClient.Version.HTTP_1_1)
    .connectTimeout(Duration.ofSeconds(5))
    .followRedirects(HttpClient.Redirect.NORMAL)
    .cookieHandler(cookies)
    .executor(r => ec.execute(r))
    .build()
  private val stopped = AtomicBoolean(false)
  private val muxOpening = AtomicBoolean(false)
  private val authed = Promise[Unit]()
  private val muxOpen = Promise[Unit]()
  @volatile private var emitMux: Json => Unit = _ => ()
  @volatile private var emitHost: Json => Unit = _ => ()
  @volatile private var socket: Option[WebSocket] = None
  @volatile private var clientId: String = ""
  private val followIds = ConcurrentHashMap.newKeySet[String]()
  private val lives = ConcurrentHashMap[String, LiveAttempt]()
  private val cursors = ConcurrentHashMap[String, java.lang.Long]()
  private val snapshots = ConcurrentHashMap[String, Json]()
  private val pendingSid = ConcurrentHashMap[String, String]()

  def call(method: String, payload: Json): Future[Json] =
    if !UnaryMethods.contains(method) then
      Future.successful(Json.obj("ok" -> Json.False, "error" -> Json.obj("code" -> "internal".asJson)))
    else
      portOf.flatMap: port =>
        ensureCookie(port).flatMap: _ =>
          cachedHistory(method, payload) match
            case Some(value) => Future.successful(Json.obj("ok" -> Json.True, "value" -> value))
            case None => post(port, method, pagePayload(method, payload))

  def reply(rpcId: String, value: Json): Future[Unit] =
    postResult(rpcId, value, rejected = false)

  override def replyCancel(rpcId: String): Future[Unit] =
    postResult(rpcId, Json.obj(), rejected = true)

  def listen(channel: String)(emit: Json => Unit): Unit =
    channel match
      case "mux"  => emitMux = emit
      case "host" => emitHost = emit
      case _      => ()

  def ready: Future[Unit] =
    if muxOpen.isCompleted then muxOpen.future
    else
      tokenOf.flatMap:
        case None | Some("") =>
          Future.failed(RuntimeException("dsh token missing"))
        case Some(tok) =>
          log.info("dsh ready: cookie + $events")
          portOf.flatMap: port =>
            authorize(port, tok).flatMap: _ =>
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
    socket.foreach: ws =>
      try ws.sendClose(WebSocket.NORMAL_CLOSURE, "close").join()
      catch case NonFatal(_) => ()
    socket = None

  private def post(port: Int, method: String, payload: Json): Future[Json] =
    val slash = remoteOf(method).getOrElse(method.replace('.', '/'))
    val req = HttpRequest.newBuilder()
      .uri(URI.create(s"http://127.0.0.1:$port/api/$slash"))
      .timeout(Duration.ofSeconds(30))
      .header("Content-Type", "application/json")
      .POST(HttpRequest.BodyPublishers.ofString(unaryEnvelope(method, payload).noSpaces, StandardCharsets.UTF_8))
      .build()
    http.sendAsync(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).asScala
      .map: res =>
        val json = io.circe.parser.parse(res.body()).getOrElse(Json.obj())
        afterUnary(method, payload, peel(res.statusCode(), json))
      .recover:
        case NonFatal(e) =>
          log.warn(s"dsh unary $method: ${e.getClass.getSimpleName}: ${e.getMessage}")
          Json.obj("ok" -> Json.False, "error" -> Json.obj("code" -> "internal".asJson))

  private def cachedHistory(method: String, payload: Json): Option[Json] =
    if method != "session.history" && method != "session.page" then None
    else
      val sid = payload.hcursor.get[String]("sessionId").toOption.getOrElse("")
      Option(snapshots.get(sid))

  private def pagePayload(method: String, payload: Json): Json =
    method match
      case "session.history" | "session.page" | "subagent.history" =>
        val sid = payload.hcursor.get[String]("sessionId").toOption.getOrElse("")
        watch(sid)
        val through =
          payload.hcursor.get[Long]("throughSeq").toOption
            .orElse(Option(cursors.get(sid)).map(_.longValue))
            .getOrElse(0L)
        payload.deepMerge(Json.obj("throughSeq" -> through.asJson))
      case _ => payload

  private def postResult(rpcId: String, value: Json, rejected: Boolean): Future[Unit] =
    val eventId = value.hcursor.get[String]("eventId")
      .orElse(value.hcursor.get[String]("approvalId"))
      .orElse(value.hcursor.get[String]("rpcId"))
      .getOrElse(rpcId)
    val args = eventResultArgs(clientId, eventId, value, rejected)
    call("$events.result", args).flatMap: json =>
      json.hcursor.get[Boolean]("ok") match
        case Right(false) =>
          val code = json.hcursor.downField("error").get[String]("code").toOption.getOrElse("internal")
          Future.failed(RuntimeException(code))
        case _ => Future.unit

  private def ensureCookie(port: Int): Future[Unit] =
    if authed.isCompleted then authed.future
    else
      tokenOf.flatMap:
        case Some(tok) if tok.nonEmpty => authorize(port, tok)
        case _                         =>
          authed.trySuccess(())
          Future.unit

  private def authorize(port: Int, token: String): Future[Unit] =
    if authed.isCompleted then authed.future
    else
      val req = HttpRequest.newBuilder()
        .uri(URI.create(s"http://127.0.0.1:$port/?token=$token"))
        .timeout(Duration.ofSeconds(10))
        .GET()
        .build()
      http.sendAsync(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).asScala
        .map: res =>
          val code = res.statusCode()
          if code == 401 || code == 403 then
            throw RuntimeException("dsh token rejected (token 可能已轮换：官方 dsh 重启后换新，在引擎设置重贴，或关闭官方 web 改由引擎托管 spawn)")
          else if code >= 400 then
            throw RuntimeException(s"dsh auth: HTTP $code")
          authed.trySuccess(())
          ()
        .recover:
          case NonFatal(e) =>
            authed.tryFailure(e)
            throw e

  private def afterUnary(method: String, payload: Json, peeled: Json): Json =
    val ok = peeled.hcursor.get[Boolean]("ok").toOption.contains(true)
    val value = peeled.hcursor.downField("value").focus.getOrElse(Json.obj())
    if ok then
      method match
        case "session.create" =>
          val sid = value.hcursor.get[String]("sessionId").toOption
            .orElse(payload.hcursor.get[String]("sessionId").toOption)
            .getOrElse("")
          watch(sid)
        case "session.prompt" | "session.cancel" | "session.selectModel" =>
          payload.hcursor.get[String]("sessionId").foreach: sid =>
            snapshots.remove(sid)
            followIds.remove(sid)
            watch(sid)
        case "subagent.list" =>
          childIds(value).foreach(watch)
        case "session.history" | "session.page" | "subagent.history" =>
          return Json.obj("ok" -> Json.True, "value" -> historyValue(value))
        case _ => ()
    peeled

  private def watch(sessionId: String): Unit =
    val sid = sessionId.trim
    if sid.isEmpty || !followIds.add(sid) then ()
    else sendFollow(sid)

  private def sendFollow(sessionId: String): Unit =
    socket.foreach: ws =>
      try ws.sendText(openFrame(s"follow:$sessionId", "session/follow", followArgs(sessionId)).noSpaces, true)
      catch case NonFatal(e) => log.warn(s"dsh follow $sessionId: ${e.getMessage}")

  private def openMux(): Unit =
    if stopped.get() || socket.isDefined || !muxOpening.compareAndSet(false, true) then ()
    else
      portOf.foreach: port =>
        if stopped.get() then muxOpening.set(false)
        else
          http.newWebSocketBuilder()
            .buildAsync(URI.create(s"ws://127.0.0.1:$port/api/remote.mux"), MuxListen())
            .whenComplete: (ws, err) =>
              muxOpening.set(false)
              if err != null then
                log.warn(s"dsh mux handshake: ${err.getMessage}")
                if stopped.get() then muxOpen.tryFailure(err)
                else reopen()
              else
                log.info("dsh mux open")
                socket = Some(ws)

  private def reopen(): Unit =
    if stopped.get() then ()
    else
      tokenOf.foreach:
        case Some(tok) if tok.nonEmpty =>
          portOf.foreach: port =>
            authorize(port, tok).foreach(_ => openMux())
        case _ => ()

  private def onRemote(raw: Json): Unit =
    raw.hcursor.get[String]("type").toOption.getOrElse("") match
      case "item" =>
        val streamId = raw.hcursor.get[String]("streamId").toOption.getOrElse("")
        val value = raw.hcursor.downField("value").focus.getOrElse(Json.obj())
        onItem(streamId, value)
      case "error" =>
        val err = raw.hcursor.downField("error").focus.getOrElse(Json.obj())
        emitMux(Json.obj("type" -> "stream/error".asJson, "error" -> err))
      case "end" =>
        raw.hcursor.get[String]("streamId").toOption.filter(_.startsWith("follow:")).foreach: id =>
          followIds.remove(id.stripPrefix("follow:"))
      case _ => ()

  private def onItem(streamId: String, value: Json): Unit =
    if streamId == "events" || streamId.isEmpty then onEvents(value)
    else if streamId == "control" then projectControl(value).foreach(emitMux)
    else if streamId.startsWith("follow:") then onFollow(streamId.stripPrefix("follow:"), value)
    else ()

  private def onEvents(value: Json): Unit =
    value.hcursor.get[String]("type").toOption.getOrElse("") match
      case "ready" =>
        clientId = value.hcursor.get[String]("clientId").toOption.getOrElse("")
        socket.foreach: ws =>
          try ws.sendText(openFrame("control", "session/control").noSpaces, true)
          catch case NonFatal(e) => log.warn(s"dsh control: ${e.getMessage}")
        followIds.asScala.foreach(sendFollow)
        muxOpen.trySuccess(())
      case "cancel" =>
        val eventId = value.hcursor.get[String]("eventId").toOption.getOrElse("")
        val sid = Option(pendingSid.remove(eventId)).getOrElse("")
        projectEvents(value.deepMerge(Json.obj("sessionId" -> sid.asJson))).foreach(emitMux)
      case _ =>
        projectEvents(value).foreach: frame =>
          frame.hcursor.get[String]("rpcId").orElse(frame.hcursor.get[String]("approvalId")).foreach: id =>
            frame.hcursor.get[String]("sessionId").foreach(sid => pendingSid.put(id, sid))
          if frame.hcursor.get[String]("type").toOption.contains("host/agent-error") then emitHost(frame)
          else emitMux(frame)

  private def onFollow(sessionId: String, value: Json): Unit =
    if value.hcursor.get[String]("type").toOption.contains("snapshot") then
      val hist = snapshotHistory(sessionId, value)
      snapshots.put(sessionId, hist)
      value.hcursor.get[Long]("cursor").foreach(c => cursors.put(sessionId, c))
    val prev = Option(lives.get(sessionId))
    val (frames, next) = projectFollow(sessionId, value, prev)
    next match
      case Some(a) => lives.put(sessionId, a)
      case None    => lives.remove(sessionId)
    frames.foreach: frame =>
      frame.hcursor.downField("event").get[Long]("seq").foreach(s => cursors.put(sessionId, s))
      emitMux(frame)

  private class MuxListen extends WebSocket.Listener:
    private val buf = StringBuilder()

    override def onOpen(ws: WebSocket): Unit =
      try ws.sendText(openFrame("events", "$events").noSpaces, true)
      catch case NonFatal(e) => log.warn(s"dsh events open: ${e.getMessage}")
      ws.request(1)

    override def onText(ws: WebSocket, data: CharSequence, last: Boolean): CompletionStage[?] =
      buf.append(data)
      if last then
        val text = buf.toString
        buf.clear()
        io.circe.parser.parse(text) match
          case Right(json) => ec.execute(() => onRemote(json))
          case Left(err) =>
            log.warn(s"dsh mux json: ${err.getMessage} bytes=${text.length}")
      ws.request(1)
      null

    override def onClose(ws: WebSocket, status: Int, reason: String): CompletionStage[?] =
      socket = None
      if !stopped.get() then reopen()
      null

    override def onError(ws: WebSocket, error: Throwable): Unit =
      if !stopped.get() then reopen()
