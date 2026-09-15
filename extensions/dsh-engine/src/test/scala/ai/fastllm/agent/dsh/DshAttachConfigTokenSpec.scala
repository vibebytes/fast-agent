package ai.fastllm.agent.dsh

import ai.fastllm.agent.engine.EngineConfig
import com.sun.net.httpserver.{HttpExchange, HttpServer}
import io.circe.Json
import io.circe.syntax.*
import org.scalatest.BeforeAndAfterEach
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.net.InetSocketAddress
import java.nio.file.Files
import scala.concurrent.Await
import scala.concurrent.duration.*

/** A running dsh web answers 200 on `/`, so `processOf` attaches. The engine config that
  * carried `port` must also carry `token`/`tokenFile` across that attach boundary; otherwise
  * a token configured in engines.yaml is silently dropped and attach fails with
  * "dsh token missing" even though the user configured one.
  */
class DshAttachConfigTokenSpec extends AnyFunSuite with Matchers with BeforeAndAfterEach:
  private var prevRoot: Option[String] = None
  private var prevHome: Option[String] = None
  private var prevProp: Option[String] = None

  override def beforeEach(): Unit =
    prevRoot = sys.props.get("fast.runtime.root")
    prevHome = sys.props.get("user.home")
    prevProp = sys.props.get("fast.dsh.token")
    val dir = Files.createTempDirectory("dsh-attach-cfg-")
    sys.props.update("fast.runtime.root", dir.toString)
    sys.props.update("user.home", dir.toString)
    sys.props.remove("fast.dsh.token")

  override def afterEach(): Unit =
    prevRoot match
      case Some(v) => sys.props.update("fast.runtime.root", v)
      case None => sys.props.remove("fast.runtime.root")
    prevHome match
      case Some(v) => sys.props.update("user.home", v)
      case None => sys.props.remove("user.home")
    prevProp match
      case Some(v) => sys.props.update("fast.dsh.token", v)
      case None => sys.props.remove("fast.dsh.token")

  test("attach to a ready dsh uses the token from engine config"):
    val server = serve()
    try
      val port = server.getAddress.getPort
      val proc = DshEngine.processOf(EngineConfig(Map("port" -> Json.fromInt(port), "token" -> "cfg-token".asJson)))
      proc shouldBe defined
      proc.get.attached shouldBe true
      Await.result(proc.get.token, 4.seconds) shouldBe Some("cfg-token")
    finally server.stop(0)

  test("attach to a ready dsh uses the tokenFile from engine config"):
    val server = serve()
    val tf = Files.createTempFile("dsh-tf-", ".txt")
    Files.writeString(tf, "file-token")
    try
      val port = server.getAddress.getPort
      val cfg = EngineConfig(Map("port" -> Json.fromInt(port), "tokenFile" -> tf.toString.asJson))
      val proc = DshEngine.processOf(cfg)
      proc shouldBe defined
      Await.result(proc.get.token, 4.seconds) shouldBe Some("file-token")
    finally server.stop(0)

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
