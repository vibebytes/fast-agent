package ai.fastllm.fast.vibe3d

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import scala.collection.mutable.ListBuffer

class Vibe3dHealthSpec extends AnyFunSuite with Matchers:

  private def monitor(answers: Iterator[Boolean]) =
    val seen = ListBuffer.empty[(String, String)]
    val health = Vibe3dHealth(() => answers.next(), (state, detail) => seen += (state -> detail), "http://127.0.0.1:7100")
    (health, seen)

  test("install already published ready, so a healthy first tick stays quiet"):
    val (health, seen) = monitor(Iterator(true, true))
    health.tick()
    health.tick()
    seen shouldBe empty

  test("only a flip republishes: down once, then ready once"):
    val (health, seen) = monitor(Iterator(true, false, false, true))
    health.tick()
    health.tick()
    seen shouldBe List("down" -> "http://127.0.0.1:7100 /health failed")
    health.tick()
    seen shouldBe List("down" -> "http://127.0.0.1:7100 /health failed")
    health.tick()
    seen shouldBe List(
      "down" -> "http://127.0.0.1:7100 /health failed",
      "ready" -> "http://127.0.0.1:7100"
    )

  test("a stopped monitor ignores late ticks and a probe that would throw"):
    val seen = ListBuffer.empty[(String, String)]
    var boom = false
    val health = Vibe3dHealth(
      () => if boom then throw IllegalStateException("gone") else true,
      (state, detail) => seen += (state -> detail),
      "http://127.0.0.1:7100"
    )
    health.tick()
    boom = true
    health.stop()
    health.tick()
    health.tick()
    seen shouldBe empty
