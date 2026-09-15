package ai.fastllm.agent.dsh

import java.net.URI
import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.time.Duration
import scala.util.control.NonFatal

object DshProbe:
  def ready(host: String, port: Int, timeoutMs: Int = 250): Boolean =
    try
      val req = HttpRequest.newBuilder(URI.create(s"http://$host:$port/"))
        .timeout(Duration.ofMillis(timeoutMs))
        .GET()
        .build()
      val res = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .build()
        .send(req, HttpResponse.BodyHandlers.discarding())
      // 401 means a dsh is bound but its launch token is unknown to us: attaching would
      // reuse a stale remembered token and every request would 401. Treat it as not ready
      // so the caller spawns and captures the fresh banner token instead.
      res.statusCode() < 400
    catch case NonFatal(_) => false
