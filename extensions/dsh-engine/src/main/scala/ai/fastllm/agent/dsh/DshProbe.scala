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
      val res = HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.discarding())
      res.statusCode() < 500
    catch case NonFatal(_) => false
