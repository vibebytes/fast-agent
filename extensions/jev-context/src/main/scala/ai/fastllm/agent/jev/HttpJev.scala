package ai.fastllm.agent.jev

import io.circe.Json
import io.circe.parser.parse

import java.net.URI
import java.net.http.{HttpClient, HttpRequest, HttpResponse, HttpTimeoutException}
import java.time.Duration
import scala.concurrent.{Future, Promise}
import scala.util.control.NonFatal

object HttpJev extends JevPost:
  private val budget = Duration.ofMillis(ClientTimeoutMs)
  private val client = HttpClient.newBuilder().connectTimeout(budget).build()

  def post(body: Json, bearer: String): Future[Either[Fault, Json]] =
    val request = HttpRequest.newBuilder(URI.create(Endpoint))
      .timeout(budget)
      .header("Authorization", s"Bearer $bearer")
      .header("Content-Type", "application/json")
      .POST(HttpRequest.BodyPublishers.ofString(body.noSpaces))
      .build()
    val done = Promise[Either[Fault, Json]]()
    try
      client.sendAsync(request, HttpResponse.BodyHandlers.ofString()).whenComplete: (response, error) =>
        if error != null then done.trySuccess(Left(faultOf(error)))
        else if response.statusCode() / 100 != 2 then done.trySuccess(Left(Fault.Status(response.statusCode())))
        else
          parse(response.body()) match
            case Right(json) => done.trySuccess(Right(json))
            case Left(_) => done.trySuccess(Left(Fault.Bad("bad json")))
    catch case NonFatal(_) => done.trySuccess(Left(Fault.Connection))
    done.future

  private def faultOf(error: Throwable): Fault =
    val cause = error match
      case wrapped if wrapped.getCause != null => wrapped.getCause
      case other => other
    cause match
      case _: HttpTimeoutException => Fault.Timeout
      case _ => Fault.Connection
