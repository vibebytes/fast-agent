package ai.fastllm.fast.vibe3d

import com.sun.net.httpserver.{HttpExchange, HttpServer}
import io.circe.parser.parse

import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent.{ExecutorService, Executors}

/** Loopback receiver for daemon `--notify-opens`: the daemon POSTs one open intent per
 * `room.create` (its autoOpen stream), and this translates it into a surface.open event for the
 * host panel. A shared token in `x-vibe3d-token` keeps other local processes out.
 */
object Vibe3dOpenListener:
  final case class Handle(port: Int, stop: () => Unit)

  private val RoomId = raw"/editor/r/(r_[a-z0-9]{8})".r

  def start(token: String, onOpen: (String, Option[String]) => Unit): Handle =
    val server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0)
    val pool = Executors.newFixedThreadPool(1, (r: Runnable) =>
      val t = Thread(r, "vibe3d-open-listener")
      t.setDaemon(true)
      t
    )
    server.createContext("/vibe3d/opens", (ex: HttpExchange) => handle(ex, token, onOpen))
    server.setExecutor(pool)
    server.start()
    Handle(server.getAddress.getPort, () =>
      server.stop(0)
      pool.shutdownNow()
    )

  private def handle(ex: HttpExchange, token: String, onOpen: (String, Option[String]) => Unit): Unit =
    try
      val code =
        if !ex.getRequestMethod.equalsIgnoreCase("POST") then 405
        else if !authorized(ex, token) then 401
        else
          val body = new String(ex.getRequestBody.readAllBytes(), StandardCharsets.UTF_8)
          val json = parse(body).toOption.flatMap(_.asObject)
          val url = json.flatMap(_("url")).flatMap(_.asString).map(_.trim).filter(_.nonEmpty)
          url match
            case None => 400
            case Some(u) =>
              val roomId = json
                .flatMap(_("roomId"))
                .flatMap(_.asString)
                .map(_.trim)
                .filter(_.nonEmpty)
                .orElse(RoomId.findFirstMatchIn(u).map(_.group(1)))
              onOpen(u, roomId)
              200
      ex.sendResponseHeaders(code, -1)
    finally ex.close()

  /** The daemon is handed the token as part of the endpoint url, so accept both the header and the
    * `k` query parameter — the opener must not need to know about headers.
    */
  private def authorized(ex: HttpExchange, token: String): Boolean =
    if ex.getRequestHeaders.getFirst("x-vibe3d-token") == token then true
    else
      val query = Option(ex.getRequestURI.getRawQuery).getOrElse("")
      query.split('&').exists { pair =>
        val i = pair.indexOf('=')
        i > 0 && pair.substring(0, i) == "k" && pair.substring(i + 1) == token
      }
