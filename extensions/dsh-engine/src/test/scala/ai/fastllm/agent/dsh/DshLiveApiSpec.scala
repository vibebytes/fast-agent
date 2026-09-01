package ai.fastllm.agent.dsh

import ai.fastllm.agent.dsh.http.DshHttp
import io.circe.Json
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.*
import scala.concurrent.{Await, Future}

/**
 * Hits a real DSH web (`settings.describe` / `agentPreset.list`). Fake HttpServer is not enough.
 * No live process and no FAST_DSH_* → cancel (not silent green). Explicit env and down → fail.
 */
class DshLiveApiSpec extends AnyFunSuite with Matchers:

  test("DshHttp settings.describe returns live DSH namespaces"):
    val live = LiveDsh.open
    try
      val remote = DshHttp(Future.successful(live.port))
      try
        val json = await(remote.call("settings.describe", Json.obj()))
        json.hcursor.get[Boolean]("ok").toOption.get shouldBe true
        val ns = namespaces(json)
        ns should contain("permission")
        ns should contain("agent-presets")
        ns should contain("locale")
      finally remote.close()
    finally live.close()

  test("DshFace settings.describe does not wait for mux and keeps live value"):
    val live = LiveDsh.open
    try
      val remote = DshHttp(Future.successful(live.port), muxReadySec = 1)
      val face = DshFace(remote, _ => "/tmp", DshLoop(remote, _ => "/tmp"))
      val json = await(face.dispatch("settings.describe", Json.obj(), None))
      json.hcursor.get[Boolean]("ok").toOption.get shouldBe true
      val value = json.hcursor.downField("value")
      value.get[Boolean]("writable").toOption shouldBe defined
      namespaces(json) should contain("permission")
    finally live.close()

  test("DshHttp agentPreset.list returns live presets"):
    val live = LiveDsh.open
    try
      val remote = DshHttp(Future.successful(live.port))
      try
        val json = await(remote.call("agentPreset.list", Json.obj()))
        json.hcursor.get[Boolean]("ok").toOption.get shouldBe true
        val ids = json.hcursor.downField("value").downField("presets").values
          .getOrElse(Vector.empty)
          .flatMap(_.hcursor.get[String]("id").toOption)
        ids should contain("minimal")
      finally remote.close()
    finally live.close()

  private def namespaces(json: Json): Vector[String] =
    json.hcursor.downField("value").downField("namespaces").values
      .getOrElse(Vector.empty)
      .flatMap(_.hcursor.get[String]("ns").toOption)
      .toVector

  private def await[A](f: Future[A]): A = Await.result(f, 15.seconds)
