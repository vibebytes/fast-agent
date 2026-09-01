package ai.fastllm.agent.dsh

import ai.fastllm.agent.remote.Client
import io.circe.Json
import io.circe.syntax.*
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.{Await, Future, Promise}
import scala.concurrent.duration.*

class DshFaceSpec extends AnyFunSuite with Matchers:

  private val Sid = "sess-1"
  private val Cwd = "/tmp/proj"

  test("session.models binds then calls; second dispatch skips create"):
    val remote = FaceClient()
    val loop = DshLoop(remote, _ => Cwd)
    val face = DshFace(remote, _ => Cwd, loop)
    val first = await(face.dispatch("session.models", Json.obj(), Some(Sid)))
    first.hcursor.get[Boolean]("ok").toOption.get shouldBe true
    first.hcursor.downField("value").get[Boolean]("routable").toOption.get shouldBe true
    remote.methods shouldBe List("session.create", "session.models")
    await(face.dispatch("session.models", Json.obj(), Some(Sid)))
    remote.methods.count(_ == "session.create") shouldBe 1
    remote.methods.count(_ == "session.models") shouldBe 2

  test("session.selectModel without sessionId is rejected"):
    val remote = FaceClient()
    val face = DshFace(remote, _ => Cwd, DshLoop(remote, _ => Cwd))
    val json = await(face.dispatch("session.selectModel", Json.obj("provider" -> "p".asJson, "model" -> "m".asJson), None))
    json.hcursor.get[Boolean]("ok").toOption.get shouldBe false
    json.hcursor.downField("error").get[String]("code").toOption.get shouldBe "bad-request"
    remote.methods shouldBe empty

  test("dispatch error keeps DSH code and message"):
    val remote = FaceClient()
    remote.models = Json.obj(
      "ok" -> Json.False,
      "error" -> Json.obj("code" -> "MISSING_CREDENTIAL".asJson, "message" -> "no key".asJson)
    )
    val face = DshFace(remote, _ => Cwd, DshLoop(remote, _ => Cwd))
    val json = await(face.dispatch("session.models", Json.obj("sessionId" -> Sid.asJson), None))
    json.hcursor.downField("error").get[String]("code").toOption.get shouldBe "MISSING_CREDENTIAL"
    json.hcursor.downField("error").get[String]("message").toOption.get shouldBe "no key"

  test("bind failure forwards session.create error object"):
    val remote = FaceClient()
    remote.create = Json.obj(
      "ok" -> Json.False,
      "error" -> Json.obj("code" -> "session-conflict".asJson, "message" -> "cwd".asJson)
    )
    val face = DshFace(remote, _ => Cwd, DshLoop(remote, _ => Cwd))
    val json = await(face.dispatch("session.models", Json.obj(), Some(Sid)))
    json.hcursor.downField("error").get[String]("code").toOption.get shouldBe "session-conflict"
    json.hcursor.downField("error").get[String]("message").toOption.get shouldBe "cwd"

  test("bind missing ok does not stamp"):
    val remote = FaceClient()
    remote.create = Json.obj("value" -> Json.obj("sessionId" -> Sid.asJson))
    val face = DshFace(remote, _ => Cwd, DshLoop(remote, _ => Cwd))
    val json = await(face.dispatch("session.models", Json.obj(), Some(Sid)))
    json.hcursor.get[Boolean]("ok").toOption.get shouldBe false
    json.hcursor.downField("error").get[String]("code").toOption.get shouldBe "internal"
    remote.methods shouldBe List("session.create")

  test("settings.describe does not bind"):
    val remote = FaceClient()
    val face = DshFace(remote, _ => Cwd, DshLoop(remote, _ => Cwd))
    await(face.dispatch("settings.describe", Json.obj(), None))
    remote.methods shouldBe List("settings.describe")

  test("settings.describe does not wait for mux ready"):
    val remote = FaceClient()
    remote.hangReady = true
    val face = DshFace(remote, _ => Cwd, DshLoop(remote, _ => Cwd))
    val json = await(face.dispatch("settings.describe", Json.obj(), None))
    json.hcursor.get[Boolean]("ok").toOption.get shouldBe true
    remote.methods shouldBe List("settings.describe")

  private def await[A](f: Future[A]): A = Await.result(f, 4.seconds)

private class FaceClient extends Client:
  var methods: Vector[String] = Vector.empty
  var hangReady: Boolean = false
  var models: Json =
    Json.obj(
      "ok" -> Json.True,
      "value" -> Json.obj(
        "current" -> Json.obj("provider" -> "deepseek-official".asJson, "model" -> "deepseek-v4-flash".asJson),
        "routable" -> Json.True,
        "groups" -> Json.arr(),
        "failures" -> Json.arr()
      )
    )
  var create: Json = Json.obj("ok" -> Json.True, "value" -> Json.obj("sessionId" -> "sess-1".asJson))
  def call(method: String, payload: Json): Future[Json] =
    methods = methods :+ method
    method match
      case "session.create"     => Future.successful(create)
      case "session.models"     => Future.successful(models)
      case "settings.describe"  => Future.successful(Json.obj("ok" -> Json.True, "value" -> Json.obj()))
      case _                    => Future.successful(Json.obj("ok" -> Json.True, "value" -> Json.obj()))
  def reply(rpcId: String, value: Json): Future[Unit] = Future.unit
  def listen(channel: String)(emit: Json => Unit): Unit = ()
  def ready: Future[Unit] = if hangReady then Promise[Unit]().future else Future.unit
  def close(): Unit = ()
