package ai.fastllm.fast.tools

import ai.fastllm.agent.ext.{Call, Field, FieldKind, Outcome, Tool}
import io.circe.Json

import scala.concurrent.Future

/** Never echo a key that is short enough to be the whole secret. */
def mask(key: String): String =
  if key.length > 4 then s"…${key.takeRight(4)}" else "…"

object ConfigProbe extends Tool:
  val name = "config_probe"
  val title = "Config probe"
  val description = "Echo the configured label and the last four characters of the configured key."
  val schema = Json.obj("type" -> Json.fromString("object"), "properties" -> Json.obj())
  override val fields = List(
    Field("apiKey", FieldKind.Secret, isRequired = true),
    Field("label", FieldKind.Text)
  )

  def run(call: Call): Future[Outcome] =
    call.secret("apiKey") match
      case None => Future.successful(Outcome.Failed("apiKey is not configured"))
      case Some(key) =>
        val label = call.value("label").getOrElse("")
        Future.successful(Outcome.Done(s"label=$label key=${mask(key)}"))
