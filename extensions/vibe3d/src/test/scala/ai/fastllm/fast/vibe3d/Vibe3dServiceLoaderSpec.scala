package ai.fastllm.fast.vibe3d

import ai.fastllm.agent.ext.Extension
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.util.ServiceLoader
import scala.jdk.CollectionConverters.*

/** The host builds extensions through `ServiceLoader.load(classOf[Extension])`, which only calls a
  * public no-arg constructor. Scala default arguments do not produce one, so this pins the seam
  * that unit tests constructing the class directly never touch.
  */
class Vibe3dRuntimeSpec extends AnyFunSuite with Matchers:
  test("the health probe speaks HTTP/1.1, because Bun answers a cleartext h2c upgrade with 404"):
    Vibe3dRuntime.healthClient.version() shouldBe java.net.http.HttpClient.Version.HTTP_1_1

  test("healthy accepts 200 and rejects a dead listener"):
    val server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext(
      "/health",
      exchange =>
        exchange.sendResponseHeaders(200, -1)
        exchange.close()
    )
    server.start()
    try
      Vibe3dRuntime.healthy(
        Vibe3dRuntime.healthClient,
        s"http://127.0.0.1:${server.getAddress.getPort}",
        java.time.Duration.ofSeconds(2)
      ) shouldBe true
    finally server.stop(0)
    Vibe3dRuntime.healthy(Vibe3dRuntime.healthClient, "http://127.0.0.1:1", java.time.Duration.ofSeconds(1)) shouldBe false

class Vibe3dServiceLoaderSpec extends AnyFunSuite with Matchers:
  test("host discovery can instantiate the extension with no arguments"):
    classOf[Vibe3dExtension].getConstructor().getParameterCount shouldBe 0

  test("ServiceLoader finds vibe3d through META-INF/services"):
    ServiceLoader
      .load(classOf[Extension])
      .asScala
      .exists(_.isInstanceOf[Vibe3dExtension]) shouldBe true
