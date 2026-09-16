package ai.fastllm.agent.dsh

import java.net.{ServerSocket, URI, URLEncoder}
import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.nio.charset.StandardCharsets
import java.time.Duration
import scala.util.control.NonFatal

object DshProbe:
  /** Any HTTP response means a web is bound — including 401 (token required). */
  def bound(host: String, port: Int, timeoutMs: Int = 250): Boolean =
    status(host, port, timeoutMs).isDefined

  /** Anonymous GET succeeded. 401 is bound but not ready without a token. */
  def ready(host: String, port: Int, timeoutMs: Int = 250): Boolean =
    status(host, port, timeoutMs).exists(_ < 400)

  /** GET `/?token=` accepted — this host is ours to attach. */
  def accepted(host: String, port: Int, token: String, timeoutMs: Int = 250): Boolean =
    val t = token.trim
    if t.isEmpty then false
    else
      val q = URLEncoder.encode(t, StandardCharsets.UTF_8)
      status(host, port, timeoutMs, s"/?token=$q").exists(c => c > 0 && c < 400)

  def freePort(): Int =
    val s = ServerSocket(0)
    try s.getLocalPort
    finally s.close()

  private def status(host: String, port: Int, timeoutMs: Int, path: String = "/"): Option[Int] =
    try
      val req = HttpRequest.newBuilder(URI.create(s"http://$host:$port$path"))
        .timeout(Duration.ofMillis(timeoutMs))
        .GET()
        .build()
      val res = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .build()
        .send(req, HttpResponse.BodyHandlers.discarding())
      Some(res.statusCode())
    catch case NonFatal(_) => None
