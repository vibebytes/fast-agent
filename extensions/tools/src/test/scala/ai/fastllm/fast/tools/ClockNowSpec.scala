package ai.fastllm.fast.tools

import ai.fastllm.agent.ext.{Call, Outcome, Risk}
import io.circe.Json
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.time.Instant
import scala.concurrent.Await
import scala.concurrent.duration.*

class ClockNowSpec extends AnyFunSuite with Matchers:
  test("clock_now returns the current UTC instant and declares no fields"):
    val outcome = Await.result(ClockNow.run(ProbeCall()), 2.seconds)
    outcome match
      case Outcome.Done(text, _) => Instant.parse(text)
      case other => fail(s"expected Done, got $other")
    ClockNow.risk shouldBe Risk.ReadOnly
    ClockNow.fields shouldBe Nil

/** Call double. `secrets` maps a key to `None` when the test wants a missing secret. */
final class ProbeCall(
    values: Map[String, String] = Map.empty,
    secrets: Map[String, Option[String]] = Map.empty
) extends Call:
  def args: Json = Json.obj()
  def sessionId: String = "s"
  def runId: String = "r"
  def isCancelled: Boolean = false
  def preview(text: String): Unit = ()
  def value(key: String): Option[String] = values.get(key)
  def secret(key: String): Option[String] = secrets.get(key).flatten
