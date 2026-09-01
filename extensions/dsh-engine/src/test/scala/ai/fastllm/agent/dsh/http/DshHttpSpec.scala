package ai.fastllm.agent.dsh.http

import io.circe.Json
import io.circe.parser.parse
import io.circe.syntax.*
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import com.sun.net.httpserver.{HttpExchange, HttpServer}
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.{Await, Future}
import scala.concurrent.duration.*

class DshHttpSpec extends AnyFunSuite with Matchers:

  test("UnaryMethods includes session.models and settings"):
    UnaryMethods should contain("subagent.list")
    UnaryMethods should contain("session.models")
    UnaryMethods should contain("session.selectModel")
    UnaryMethods should contain("skill.list")
    UnaryMethods should contain("settings.describe")
    UnaryMethods should contain("credentials.set")
    UnaryMethods should contain("llm.models")
    UnaryMethods should contain("agentPreset.list")
    UnaryMethods should contain("pluginInventory.list")
    UnaryMethods should contain("subagent.prompt")
    UnaryMethods should contain("subagent.interrupt")
    UnaryMethods should contain("subagent.history")
    UnaryMethods should contain("session.updateQueue")
    UnaryMethods should contain("session.attachment")
    UnaryMethods should contain("goal.create")
    UnaryMethods should contain("goal.edit")
    UnaryMethods should contain("goal.pause")
    UnaryMethods should contain("goal.resume")
    UnaryMethods should contain("goal.complete")
    UnaryMethods should contain("goal.clear")

  test("unaryEnvelope is client-request with method and payload"):
    val body = unaryEnvelope("host.describe", Json.obj("x" -> Json.True))
    body.hcursor.get[String]("type").toOption.get shouldBe "client-request"
    body.hcursor.get[String]("method").toOption.get shouldBe "host.describe"
    body.hcursor.downField("payload").get[Boolean]("x").toOption.get shouldBe true
    body.hcursor.get[String]("rpcId").toOption.get should not be empty

  test("peel 200 result.ok value"):
    val body = Json.obj(
      "type" -> "server-response".asJson,
      "rpcId" -> "r1".asJson,
      "result" -> Json.obj("ok" -> Json.True, "value" -> Json.obj("ok" -> Json.True))
    )
    val out = peel(200, body)
    out.hcursor.get[Boolean]("ok").toOption.get shouldBe true
    out.hcursor.downField("value").get[Boolean]("ok").toOption.get shouldBe true

  test("peel 200 result error keeps DSH code"):
    val body = Json.obj(
      "type" -> "server-response".asJson,
      "rpcId" -> "r1".asJson,
      "result" -> Json.obj(
        "ok" -> Json.False,
        "error" -> Json.obj("code" -> "session-conflict".asJson, "message" -> "cwd".asJson)
      )
    )
    val err = peel(200, body).hcursor.downField("error")
    err.get[String]("code").toOption.get shouldBe "session-conflict"
    err.get[String]("message").toOption.get shouldBe "cwd"

  test("peel HTTP 4xx is always internal"):
    val body = Json.obj(
      "type" -> "server-response".asJson,
      "result" -> Json.obj("ok" -> Json.False, "error" -> Json.obj("code" -> "session-conflict".asJson))
    )
    peel(403, body).hcursor.downField("error").get[String]("code").toOption.get shouldBe "internal"
    peel(415, Json.obj()).hcursor.downField("error").get[String]("code").toOption.get shouldBe "internal"

  test("muxFrame peels server-request payload"):
    val inner = Json.obj(
      "type" -> "session/event".asJson,
      "sessionId" -> "s".asJson,
      "event" -> Json.obj("type" -> "turn/start".asJson)
    )
    val wrap = Json.obj(
      "type" -> "server-request".asJson,
      "rpcId" -> "r".asJson,
      "method" -> "session/event".asJson,
      "payload" -> inner
    )
    muxFrame(wrap) shouldBe inner
    muxFrame(inner) shouldBe inner

  test("POST host.describe peels FakeWire-shaped ok"):
    val (port, server) = serve: (method, body) =>
      method shouldBe "host.describe"
      parse(body).toOption.get.hcursor.get[String]("type").toOption.get shouldBe "client-request"
      (
        200,
        Json.obj(
          "type" -> "server-response".asJson,
          "rpcId" -> "echo".asJson,
          "result" -> Json.obj("ok" -> Json.True, "value" -> Json.obj("ok" -> Json.True))
        ).noSpaces
      )
    try
      val remote = DshHttp(Future.successful(port))
      val json = await(remote.call("host.describe", Json.obj()))
      json.hcursor.get[Boolean]("ok").toOption.get shouldBe true
    finally server.stop(0)

  test("POST 4xx → internal; unknown method never hits the wire"):
    val (port, server) = serve: (_, _) =>
      (404, """{"type":"server-response","rpcId":"x","result":{"ok":false,"error":{"code":"bad-request"}}}""")
    try
      val remote = DshHttp(Future.successful(port))
      await(remote.call("session.fork", Json.obj()))
        .hcursor.downField("error").get[String]("code").toOption.get shouldBe "internal"
      await(remote.call("host.describe", Json.obj()))
        .hcursor.downField("error").get[String]("code").toOption.get shouldBe "internal"
    finally server.stop(0)

  test("settings.describe over HTTP does not require mux"):
    import ai.fastllm.agent.dsh.{DshFace, DshLoop}
    val (port, server) = serve: (method, _) =>
      method shouldBe "settings.describe"
      (
        200,
        Json.obj(
          "type" -> "server-response".asJson,
          "rpcId" -> "echo".asJson,
          "result" -> Json.obj(
            "ok" -> Json.True,
            "value" -> Json.obj(
              "writable" -> Json.True,
              "hasDocument" -> Json.False,
              "namespaces" -> Json.arr()
            )
          )
        ).noSpaces
      )
    try
      val remote = DshHttp(Future.successful(port), muxReadySec = 1)
      val face = DshFace(remote, _ => "/tmp", DshLoop(remote, _ => "/tmp"))
      val json = await(face.dispatch("settings.describe", Json.obj(), None))
      json.hcursor.get[Boolean]("ok").toOption.get shouldBe true
      json.hcursor.downField("value").get[Boolean]("writable").toOption.get shouldBe true
    finally server.stop(0)

  test("ready times out when mux never opens"):
    val (port, server) = serve: (method, _) =>
      method shouldBe "host.describe"
      (
        200,
        Json.obj(
          "type" -> "server-response".asJson,
          "rpcId" -> "echo".asJson,
          "result" -> Json.obj("ok" -> Json.True, "value" -> Json.obj("ok" -> Json.True))
        ).noSpaces
      )
    try
      val remote = DshHttp(Future.successful(port), muxReadySec = 1)
      try
        val ex = intercept[Exception](await(remote.ready))
        ex.getMessage should include("dsh mux")
      finally remote.close()
    finally server.stop(0)

  test("POST /api/respond accepted true; not-pending fails the Future"):
    val (port, server) = serve: (method, body) =>
      method shouldBe "respond"
      parse(body).toOption.get.hcursor.get[String]("type").toOption.get shouldBe "client-response"
      val outcome = parse(body).toOption.get.hcursor.downField("result").downField("value").get[String]("outcome").toOption.get
      if outcome == "allowed-once" then (200, """{"accepted":true}""")
      else (200, """{"accepted":false,"reason":"not-pending"}""")
    try
      val remote = DshHttp(Future.successful(port))
      await(remote.reply("rpc-1", Json.obj("sessionId" -> "s".asJson, "approvalId" -> "a".asJson, "outcome" -> "allowed-once".asJson)))
      val ex = intercept[Exception]:
        await(remote.reply("rpc-1", Json.obj("sessionId" -> "s".asJson, "approvalId" -> "a".asJson, "outcome" -> "rejected".asJson)))
      ex.getMessage shouldBe "not-pending"
    finally server.stop(0)

  test("replyCancel posts ok=false cancelled"):
    var seen = ""
    val (port, server) = serve: (method, body) =>
      method shouldBe "respond"
      seen = body
      (200, """{"accepted":true}""")
    try
      val remote = DshHttp(Future.successful(port))
      await(remote.replyCancel("rpc-q"))
      val result = parse(seen).toOption.get.hcursor.downField("result")
      result.get[Boolean]("ok").toOption.get shouldBe false
      result.downField("error").get[String]("code").toOption.get shouldBe "cancelled"
    finally server.stop(0)

  private def await[A](f: Future[A]): A = Await.result(f, 4.seconds)

  private def serve(handler: (String, String) => (Int, String)): (Int, HttpServer) =
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext(
      "/api",
      (ex: HttpExchange) =>
        val method = ex.getRequestURI.getPath.stripPrefix("/api/")
        val body = String(ex.getRequestBody.readAllBytes(), StandardCharsets.UTF_8)
        val (code, resp) = handler(method, body)
        val bytes = resp.getBytes(StandardCharsets.UTF_8)
        ex.getResponseHeaders.add("Content-Type", "application/json")
        ex.sendResponseHeaders(code, bytes.length)
        ex.getResponseBody.write(bytes)
        ex.close()
    )
    server.start()
    (server.getAddress.getPort, server)
