package ai.fastllm.fast.tools

import ai.fastllm.agent.ext.{Field, FieldKind, Outcome}
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import scala.concurrent.Await
import scala.concurrent.duration.*

class ConfigProbeSpec extends AnyFunSuite with Matchers:
  test("config_probe echoes the label and the last four characters of the key"):
    val call = ProbeCall(values = Map("label" -> "demo"), secrets = Map("apiKey" -> Some("sk-test-1234")))
    Await.result(ConfigProbe.run(call), 2.seconds) match
      case Outcome.Done(text, _) => text shouldBe "label=demo key=…1234"
      case other => fail(s"expected Done, got $other")

  test("config_probe does not echo a key that is four characters or shorter"):
    mask("ab") shouldBe "…"
    mask("1234") shouldBe "…"
    mask("12345") shouldBe "…2345"
    val call = ProbeCall(values = Map("label" -> "demo"), secrets = Map("apiKey" -> Some("abcd")))
    Await.result(ConfigProbe.run(call), 2.seconds) match
      case Outcome.Done(text, _) =>
        text shouldBe "label=demo key=…"
        text should not include "abcd"
      case other => fail(s"expected Done, got $other")

  test("config_probe fails when the key is missing"):
    val call = ProbeCall(secrets = Map("apiKey" -> None))
    Await.result(ConfigProbe.run(call), 2.seconds) match
      case Outcome.Failed(reason, _) => reason should include("apiKey")
      case other => fail(s"expected Failed, got $other")

  test("config_probe declares a required secret and an optional label"):
    ConfigProbe.fields shouldBe List(
      Field("apiKey", FieldKind.Secret, isRequired = true),
      Field("label", FieldKind.Text)
    )
