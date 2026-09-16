package ai.fastllm.agent.dsh

import ai.fastllm.agent.engine.EngineConfig
import com.sun.net.httpserver.{HttpExchange, HttpHandler, HttpServer}
import io.circe.Json
import io.circe.syntax.*
import org.scalatest.BeforeAndAfterEach
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.net.InetSocketAddress
import java.nio.file.Files

class DshProbeSpec extends AnyFunSuite with Matchers with BeforeAndAfterEach:
  private var prevRoot: Option[String] = None

  override def beforeEach(): Unit =
    prevRoot = sys.props.get("fast.runtime.root")
    sys.props.update("fast.runtime.root", Files.createTempDirectory("dsh-probe-").toString)

  override def afterEach(): Unit =
    prevRoot match
      case Some(v) => sys.props.update("fast.runtime.root", v)
      case None => sys.props.remove("fast.runtime.root")

  private def serve(status: Int, body: String = ""): (HttpServer, Int) =
    val server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext(
      "/",
      new HttpHandler:
        def handle(ex: HttpExchange): Unit =
          val bytes = body.getBytes("UTF-8")
          ex.sendResponseHeaders(status, bytes.length)
          ex.getResponseBody.write(bytes)
          ex.close()
    )
    server.start()
    (server, server.getAddress.getPort)

  test("401 is bound but not anonymously ready"):
    val (server, port) = serve(401, "dsh web authentication required")
    try
      DshProbe.bound("127.0.0.1", port) shouldBe true
      DshProbe.ready("127.0.0.1", port) shouldBe false
    finally server.stop(0)

  test("processOf attaches to a 401 web when there is no local install"):
    val (server, port) = serve(401, "dsh web authentication required")
    try
      val proc = DshEngine.processOf(EngineConfig(Map("port" -> Json.fromInt(port))))
      proc shouldBe defined
      proc.get.attached shouldBe true
    finally server.stop(0)

  test("accepted is true only when /?token= is under 400"):
    val server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext(
      "/",
      new HttpHandler:
        def handle(ex: HttpExchange): Unit =
          val q = Option(ex.getRequestURI.getRawQuery).getOrElse("")
          val code = if q.contains("token=good") then 200 else 401
          ex.sendResponseHeaders(code, -1)
          ex.close()
    )
    server.start()
    try
      val port = server.getAddress.getPort
      DshProbe.accepted("127.0.0.1", port, "good") shouldBe true
      DshProbe.accepted("127.0.0.1", port, "stale") shouldBe false
    finally server.stop(0)

  test("401 with a stale token and a local install spawns on a free port"):
    val root = DshRoots.of()
    Files.createDirectories(root.resolve("node_modules/@deepseek-ai/dsh/lib"))
    Files.writeString(root.resolve("node_modules/@deepseek-ai/dsh/package.json"), "{}")
    Files.writeString(root.resolve("node_modules/@deepseek-ai/dsh/lib/bin.js"), "//")
    val (server, port) = serve(401, "dsh web authentication required")
    try
      val proc = DshEngine.processOf(EngineConfig(Map("port" -> Json.fromInt(port), "token" -> "stale".asJson)))
      proc shouldBe defined
      proc.get.attached shouldBe false
    finally server.stop(0)

  test("ready is true for a serving 200 server"):
    val (server, port) = serve(200, "<html></html>")
    try
      DshProbe.bound("127.0.0.1", port) shouldBe true
      DshProbe.ready("127.0.0.1", port) shouldBe true
    finally server.stop(0)

  test("ready is false when nothing is listening"):
    DshProbe.bound("127.0.0.1", 1) shouldBe false
    DshProbe.ready("127.0.0.1", 1) shouldBe false
