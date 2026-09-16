package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.AgentEvent
import ai.fastllm.agent.engine.{EngineEventSink, EngineHosts, MissingHost, Wave1Host}
import io.circe.Json
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import scala.concurrent.Future
import scala.concurrent.duration.*

class DshRiverSpec extends AnyFunSuite with Matchers:

  test("engine river follows Wave1Host.events after CommandLoop wires it"):
    val host: Wave1Host = EngineHosts.wave1()
    val river = DshRiver.engine(host.events)
    intercept[MissingHost](host.events.append("s", None, Nil))
    river.append("s", None, List(Json.obj("t" -> Json.fromString("x")))) shouldBe Nil

    val wired = RecordingSink()
    host.events = wired
    river.append("s", Some("r"), List(Json.obj("t" -> Json.fromString("hi")))) shouldBe List(7L)
    wired.appended shouldBe 1

  test("engine river does not retry a failed append"):
    val sink = CountingFailSink()
    DshRiver.engine(sink, 50.millis).append("s", None, List(Json.obj("t" -> Json.fromString("x")))) shouldBe Nil
    sink.appended shouldBe 1

  private final class CountingFailSink extends EngineEventSink:
    var appended = 0
    def error(sessionId: String, message: String) = ()
    def goal(sessionId: String, op: String, phase: String, title: String, text: String) = ()
    def append(sessionId: String, runId: Option[String], events: List[AgentEvent]) =
      appended += 1
      Future.failed(java.util.concurrent.TimeoutException("boom"))
    def live(sessionId: String, runId: Option[String], events: List[AgentEvent]) = ()
    def read(sessionId: String, afterSeq: Long) = Future.successful(Nil)

  private final class RecordingSink extends EngineEventSink:
    var appended = 0
    def error(sessionId: String, message: String) = ()
    def goal(sessionId: String, op: String, phase: String, title: String, text: String) = ()
    def append(sessionId: String, runId: Option[String], events: List[AgentEvent]) =
      appended += 1
      Future.successful(events.indices.map(i => 7L + i).toList)
    def live(sessionId: String, runId: Option[String], events: List[AgentEvent]) = ()
    def read(sessionId: String, afterSeq: Long) = Future.successful(Nil)
