package ai.fastllm.agent.dsh

import com.sun.net.httpserver.{HttpExchange, HttpHandler, HttpServer}
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.net.InetSocketAddress

class DshProbeSpec extends AnyFunSuite with Matchers:

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

  test("ready is false for an auth-required 401 server so processOf spawns instead of attaching"):
    val (server, port) = serve(401, "dsh web authentication required")
    try DshProbe.ready("127.0.0.1", port) shouldBe false
    finally server.stop(0)

  test("ready is true for a serving 200 server"):
    val (server, port) = serve(200, "<html></html>")
    try DshProbe.ready("127.0.0.1", port) shouldBe true
    finally server.stop(0)

  test("ready is false when nothing is listening"):
    DshProbe.ready("127.0.0.1", 1) shouldBe false
