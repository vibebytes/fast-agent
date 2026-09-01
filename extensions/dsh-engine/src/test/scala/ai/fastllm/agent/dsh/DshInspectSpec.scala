package ai.fastllm.agent.dsh

import ai.fastllm.agent.dsh.proc.DshProcess
import ai.fastllm.agent.engine.{EngineConfig, ProcessPhase, ProgramPhase}
import com.sun.net.httpserver.{HttpExchange, HttpServer}
import io.circe.Json
import org.scalatest.BeforeAndAfterEach
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.net.InetSocketAddress
import java.nio.file.{Files, Path}

class DshInspectSpec extends AnyFunSuite with Matchers with BeforeAndAfterEach:
  private var prevRoot: Option[String] = None

  override def beforeEach(): Unit =
    prevRoot = sys.props.get("fast.runtime.root")
    sys.props.update("fast.runtime.root", Files.createTempDirectory("dsh-root-").toString)

  override def afterEach(): Unit =
    prevRoot match
      case Some(v) => sys.props.update("fast.runtime.root", v)
      case None => sys.props.remove("fast.runtime.root")

  test("no user root and closed port is missing / none without processDetail"):
    val probe = DshInspect().probe(EngineConfig(Map("port" -> Json.fromInt(closedPort()))))
    probe.program shouldBe ProgramPhase.Missing
    probe.process shouldBe ProcessPhase.None
    probe.runningDetail shouldBe None

  test("complete user root is installed"):
    val root = DshRoots.of()
    Files.createDirectories(root.resolve("node_modules/@deepseek-ai/dsh"))
    Files.writeString(root.resolve("node_modules/@deepseek-ai/dsh/package.json"), """{"name":"@deepseek-ai/dsh"}""")
    DshRoots.installed(root) shouldBe true
    val probe = DshInspect().probe(EngineConfig(Map("port" -> Json.fromInt(closedPort()))))
    probe.program shouldBe ProgramPhase.Installed
    probe.process shouldBe ProcessPhase.Stopped
    probe.runningDetail shouldBe None

  test("HTTP ready without user root is missing / running with host:port"):
    val server = serve()
    try
      val port = server.getAddress.getPort
      val probe = DshInspect().probe(EngineConfig(Map("port" -> Json.fromInt(port))))
      probe.program shouldBe ProgramPhase.Missing
      probe.process shouldBe ProcessPhase.Running
      probe.runningDetail shouldBe Some(s"127.0.0.1:$port")
      probe.detail.get should not include "http"
      probe.detail.get should not include "pid"
    finally server.stop(0)

  test("processDetail absent when process is not running"):
    val probe = DshInspect().probe(EngineConfig(Map("port" -> Json.fromInt(closedPort()))))
    probe.process should not be ProcessPhase.Running
    probe.runningDetail shouldBe None

  test("inspect does not ProcessBuilder.start"):
    val before = ProcessHandle.current().descendants().count()
    DshInspect().probe(EngineConfig(Map("port" -> Json.fromInt(closedPort()))))
    val after = ProcessHandle.current().descendants().count()
    after shouldBe before

  test("start without install or ready port does not spawn"):
    DshEngine.processOf(EngineConfig(Map("port" -> Json.fromInt(closedPort())))) shouldBe None

  test("attach stop does not destroy an external pid"):
    val proc = DshProcess.attach(3080)
    proc.attached shouldBe true
    proc.close()
    proc.destroys shouldBe 0

  test("spawned child is destroyed on close"):
    val proc = DshProcess.spawn("/bin/sleep 30")
    val _ = proc.port
    Thread.sleep(80)
    proc.close()
    proc.destroys shouldBe 1

  test("local spawn command never contains npx --yes"):
    val root = DshRoots.of()
    Files.createDirectories(root.resolve("node_modules/.bin"))
    Files.writeString(root.resolve("node_modules/.bin/dsh"), "#!/bin/sh\n")
    Files.createDirectories(root.resolve("node_modules/@deepseek-ai/dsh"))
    Files.writeString(root.resolve("node_modules/@deepseek-ai/dsh/package.json"), "{}")
    val cmd = DshRoots.command(root).get
    cmd should not include "npx --yes"
    DshRoots.rejectsNpx("npx --yes @deepseek-ai/dsh web") shouldBe true

  private def closedPort(): Int =
    val s = java.net.ServerSocket(0)
    val p = s.getLocalPort
    s.close()
    p

  private def serve(): HttpServer =
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext(
      "/",
      (ex: HttpExchange) =>
        val body = Array.empty[Byte]
        ex.sendResponseHeaders(200, body.length)
        ex.getResponseBody.close()
    )
    server.start()
    server
