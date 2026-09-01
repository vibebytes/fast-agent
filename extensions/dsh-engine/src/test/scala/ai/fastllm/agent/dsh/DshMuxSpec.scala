package ai.fastllm.agent.dsh

import io.circe.Json
import io.circe.syntax.*
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

class DshMuxSpec extends AnyFunSuite with Matchers:

  test("server-request copies envelope rpcId onto approval/requested"):
    val inner = Json.obj(
      "type" -> "approval/requested".asJson,
      "sessionId" -> "s".asJson,
      "approvalId" -> "ap".asJson,
      "toolName" -> "bash".asJson,
      "reason" -> "sandbox".asJson,
      "callId" -> "c1".asJson
    )
    val wrap = Json.obj(
      "type" -> "server-request".asJson,
      "rpcId" -> "rpc-env".asJson,
      "method" -> "approval/requested".asJson,
      "payload" -> inner
    )
    muxOf(wrap) shouldBe Some(
      Mux.ApprovalAsked("s", "rpc-env", "ap", "bash", Some("sandbox"), Some("c1"))
    )
    muxOf(inner) shouldBe Some(Mux.ApprovalAsked("s", "", "ap", "bash", Some("sandbox"), Some("c1")))

  test("approval/resolved keeps outcome"):
    muxOf(
      Json.obj(
        "type" -> "approval/resolved".asJson,
        "sessionId" -> "s".asJson,
        "approvalId" -> "ap".asJson,
        "outcome" -> "cancelled".asJson
      )
    ) shouldBe Some(Mux.ApprovalDone("s", "ap", "cancelled"))

  test("server-request copies envelope rpcId onto question/requested"):
    val inner = Json.obj(
      "type" -> "question/requested".asJson,
      "sessionId" -> "s".asJson,
      "questions" -> Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson))
    )
    muxOf(
      Json.obj(
        "type" -> "server-request".asJson,
        "rpcId" -> "rpc-q".asJson,
        "method" -> "question/requested".asJson,
        "payload" -> inner
      )
    ) shouldBe Some(Mux.QuestionAsked("s", "rpc-q", inner))
    muxOf(inner) shouldBe Some(Mux.QuestionAsked("s", "", inner))

  test("question/resolved uses questionRpcId"):
    muxOf(
      Json.obj(
        "type" -> "question/resolved".asJson,
        "sessionId" -> "s".asJson,
        "questionRpcId" -> "rpc-q".asJson,
        "outcome" -> "answered".asJson
      )
    ) shouldBe Some(Mux.QuestionDone("s", "rpc-q", "answered"))
    muxOf(
      Json.obj(
        "type" -> "question/resolved".asJson,
        "sessionId" -> "s".asJson,
        "outcome" -> "answered".asJson
      )
    ) shouldBe None

  test("session/queue becomes Mux.Queue; unknown mux is None"):
    muxOf(
      Json.obj(
        "type" -> "session/queue".asJson,
        "sessionId" -> "s".asJson,
        "items" -> Json.arr()
      )
    ) shouldBe Some(Mux.Queue("s", Json.arr()))
    muxOf(Json.obj("type" -> "session/mystery".asJson, "sessionId" -> "s".asJson)) shouldBe None
