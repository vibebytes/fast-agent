package ai.fastllm.fast.tools

import ai.fastllm.agent.ext.{Call, Outcome, Tool}
import io.circe.Json

import java.time.Instant
import scala.concurrent.Future

object ClockNow extends Tool:
  val name = "clock_now"
  val title = "Clock now"
  val description = "Current UTC time in ISO-8601."
  val schema = Json.obj("type" -> Json.fromString("object"), "properties" -> Json.obj())
  def run(call: Call): Future[Outcome] = Future.successful(Outcome.Done(Instant.now().toString))
