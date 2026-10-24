package ai.fastllm.fast.vibe3d

import java.net.URI
import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.time.Duration

/** What a started daemon gives back: the base url the MCP client dials and the panel url. */
trait Vibe3dRuntime:
  def start(cfg: Vibe3dConfig): Either[String, Vibe3dRuntime.Live]
  def stop(): Unit

object Vibe3dRuntime:
  final case class Live(pid: Long, port: Int, token: String):
    def baseUrl: String = s"http://127.0.0.1:$port"

  /** Probe `/health`; 401/403 still prove the listener is up (auth wraps the router on some builds). */
  def healthy(client: HttpClient, baseUrl: String, timeout: Duration): Boolean =
    try
      val req = HttpRequest.newBuilder(URI.create(s"$baseUrl/health")).timeout(timeout).GET().build()
      val code = client.send(req, HttpResponse.BodyHandlers.discarding()).statusCode()
      code == 200 || code == 401 || code == 403
    catch case _: Exception => false
