package ai.fastllm.fast.vibe3d

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.net.URI
import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.nio.charset.StandardCharsets
import java.time.Duration
import scala.collection.mutable.ListBuffer

class Vibe3dOpenListenerSpec extends AnyFunSuite with Matchers:
  private val client: HttpClient =
    HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).version(HttpClient.Version.HTTP_1_1).build()

  private def post(port: Int, token: String, body: String, method: String = "POST", query: String = ""): Int =
    val builder = HttpRequest
      .newBuilder(URI.create(s"http://127.0.0.1:$port/vibe3d/opens$query"))
      .timeout(Duration.ofSeconds(2))
      .method(method, HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
    if token.nonEmpty then builder.header("x-vibe3d-token", token)
    client.send(builder.build(), HttpResponse.BodyHandlers.discarding()).statusCode()

  test("binds a loopback endpoint and forwards token-verified opens"):
    val received = ListBuffer.empty[(String, Option[String])]
    val ep = Vibe3dOpenListener.start("tok", (url, roomId) => received += ((url, roomId)))
    try
      ep.port should be > 0
      val roomUrl = "http://127.0.0.1:7100/editor/r/r_abc12345?t=tok"
      post(ep.port, "tok", s"""{"url":"$roomUrl"}""") shouldBe 200
      received.toList shouldBe List((roomUrl, Some("r_abc12345")))
    finally ep.stop()

  test("a roomId in the body wins over the one parsed from the url"):
    val received = ListBuffer.empty[(String, Option[String])]
    val ep = Vibe3dOpenListener.start("tok", (url, roomId) => received += ((url, roomId)))
    try
      post(ep.port, "tok", """{"url":"http://127.0.0.1:1/editor/r/r_00000000","roomId":"r_ffffffff"}""") shouldBe 200
      received.toList shouldBe List(("http://127.0.0.1:1/editor/r/r_00000000", Some("r_ffffffff")))
    finally ep.stop()

  test("accepts the token from the endpoint's query parameter too — the opener needs no headers"):
    val received = ListBuffer.empty[(String, Option[String])]
    val ep = Vibe3dOpenListener.start("tok", (url, roomId) => received += ((url, roomId)))
    try
      post(ep.port, "", """{"url":"http://127.0.0.1:7100/editor/r/r_abc12345","roomId":"r_abc12345"}""", query = "?k=tok") shouldBe 200
      received.toList shouldBe List(("http://127.0.0.1:7100/editor/r/r_abc12345", Some("r_abc12345")))
    finally ep.stop()

  test("rejects wrong tokens, other methods and bodies without a url"):
    val received = ListBuffer.empty[(String, Option[String])]
    val ep = Vibe3dOpenListener.start("tok", (url, roomId) => received += ((url, roomId)))
    try
      post(ep.port, "wrong", """{"url":"http://x/editor/r/r_abc12345"}""") shouldBe 401
      post(ep.port, "tok", """{"url":"http://x/editor/r/r_abc12345"}""", method = "GET") shouldBe 405
      post(ep.port, "tok", """{"roomId":"r_abc12345"}""") shouldBe 400
      received.toList shouldBe Nil
    finally ep.stop()

  test("an unparseable body is a 400, a parseable one with a bad url is a 400 too"):
    val received = ListBuffer.empty[(String, Option[String])]
    val ep = Vibe3dOpenListener.start("tok", (url, roomId) => received += ((url, roomId)))
    try
      post(ep.port, "tok", "not json") shouldBe 400
      received.toList shouldBe Nil
    finally ep.stop()
