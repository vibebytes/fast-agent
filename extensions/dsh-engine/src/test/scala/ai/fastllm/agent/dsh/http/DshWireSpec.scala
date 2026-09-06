package ai.fastllm.agent.dsh.http

import io.circe.Json
import io.circe.syntax.*
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

class DshWireSpec extends AnyFunSuite with Matchers:

  test("Fast dotted aliases map onto the 0.1.2-rc.1 Remote slash table"):
    remoteOf("session.create") shouldBe Some("session/create")
    remoteOf("session.history") shouldBe Some("session/page")
    remoteOf("session.models") shouldBe Some("session/modelCatalog")
    remoteOf("llm.models") shouldBe Some("session/modelCatalog")
    remoteOf("llm.providers") shouldBe Some("llm/listProviders")
    remoteOf("skill.list") shouldBe Some("skills/list")
    remoteOf("goal.create") shouldBe Some("goals/create")
    remoteOf("agentPreset.remove") shouldBe Some("agentPresets/deletePreset")
    remoteOf("agentPreset.openDocument") shouldBe Some("settings/openAgentPresetDirectory")
    remoteOf("settings.openDocument") shouldBe Some("settings/openSettingsDocument")
    remoteOf("subagent.interrupt") shouldBe Some("subagents/interruptByParent")
    remoteOf("subagent.history") shouldBe Some("session/page")
    remoteOf("$events.result") shouldBe Some("$events/result")
    remoteOf("host.describe") shouldBe None

  test("unaryEnvelope wraps Typert args and uses the slash method"):
    val body = unaryEnvelope("settings.describe", Json.obj("x" -> Json.True))
    body.hcursor.get[String]("type").toOption.get shouldBe "client-request"
    body.hcursor.get[String]("method").toOption.get shouldBe "settings/describe"
    body.hcursor.downField("payload").downField("args").focus.get shouldBe Json.obj()
    body.hcursor.get[String]("rpcId").toOption.get should not be empty

  test("session.list args use _request; prompt stays under request"):
    argsOf("session.list", Json.obj()) shouldBe Json.obj("_request" -> Json.obj())
    argsOf("session.prompt", Json.obj("sessionId" -> "s".asJson, "requestId" -> "r1".asJson)) shouldBe
      Json.obj("request" -> Json.obj("sessionId" -> "s".asJson, "requestId" -> "r1".asJson))
    argsOf("session.models", Json.obj("sessionId" -> "s".asJson)) shouldBe Json.obj()
    argsOf("settings.update", Json.obj("ns" -> "locale".asJson, "patch" -> Json.obj(), "expectedRevision" -> Json.fromLong(1))) shouldBe
      Json.obj("ns" -> "locale".asJson, "patch" -> Json.obj(), "expectedRevision" -> Json.fromLong(1))
    argsOf("goal.pause", Json.obj("sessionId" -> "s".asJson, "id" -> "g1".asJson, "revision" -> Json.fromLong(2))) shouldBe
      Json.obj(
        "agentId" -> "s".asJson,
        "ref" -> Json.obj("id" -> "g1".asJson, "revision" -> Json.fromLong(2))
      )
    argsOf("skill.list", Json.obj("sessionId" -> "s".asJson)) shouldBe
      Json.obj("request" -> Json.obj("sessionId" -> "s".asJson))

  test("history page address is session or subagent; records peel to events"):
    argsOf("session.history", Json.obj("sessionId" -> "s".asJson, "throughSeq" -> Json.fromLong(9))) shouldBe
      Json.obj(
        "request" -> Json.obj(
          "address" -> Json.obj("kind" -> "session".asJson, "sessionId" -> "s".asJson),
          "throughSeq" -> Json.fromLong(9)
        )
      )
    val inner = Json.obj("type" -> "turn/start".asJson, "seq" -> Json.fromLong(1))
    val page = Json.obj(
      "records" -> Json.arr(Json.obj("type" -> "event".asJson, "event" -> inner)),
      "hasMore" -> Json.False
    )
    historyValue(page).hcursor.downField("events").as[List[Json]].toOption.get shouldBe List(inner)
    historyValue(page).hcursor.downField("records").focus shouldBe None

  test("follow snapshot and assistant-stream project onto the old Mux ADT"):
    val snap = Json.obj(
      "type" -> "snapshot".asJson,
      "cursor" -> Json.fromLong(4),
      "hasMore" -> Json.False,
      "records" -> Json.arr(
        Json.obj("type" -> "event".asJson, "event" -> Json.obj("type" -> "turn/start".asJson, "seq" -> Json.fromLong(1)))
      )
    )
    val (opened, live0) = projectFollow("s1", snap, None)
    opened.head.hcursor.get[String]("type").toOption.get shouldBe "session/subscribed"
    opened.head.hcursor.get[Long]("lastSeq").toOption.get shouldBe 4L
    opened(1).hcursor.get[String]("type").toOption.get shouldBe "session/event"
    live0 shouldBe None

    val start = Json.obj(
      "type" -> "assistant-stream".asJson,
      "frame" -> Json.obj(
        "type" -> "start".asJson,
        "attemptId" -> "a1".asJson,
        "turn" -> Json.fromLong(2),
        "step" -> Json.fromLong(1)
      )
    )
    val (none, live) = projectFollow("s1", start, None)
    none shouldBe Nil
    live.map(_.attemptId) shouldBe Some("a1")

    val chunk = Json.obj(
      "type" -> "assistant-stream".asJson,
      "frame" -> Json.obj(
        "type" -> "chunk".asJson,
        "time" -> Json.fromLong(9),
        "chunk" -> Json.obj("type" -> "text-delta".asJson, "text" -> "Hi".asJson)
      )
    )
    val (chunks, _) = projectFollow("s1", chunk, live)
    val ev = chunks.head.hcursor.downField("event").focus.get
    ev.hcursor.get[String]("type").toOption.get shouldBe "assistant/chunk"
    ev.hcursor.get[Long]("seq").toOption shouldBe None
    ev.hcursor.downField("data").get[Long]("turn").toOption.get shouldBe 2L
    ev.hcursor.downField("data").downField("chunk").get[String]("text").toOption.get shouldBe "Hi"

  test("$events waterfall and emit project to mux and host frames"):
    val asked = projectEvents(
      Json.obj(
        "type" -> "waterfall".asJson,
        "event" -> "approval/request".asJson,
        "eventId" -> "e1".asJson,
        "agentId" -> "s1".asJson,
        "request" -> Json.obj("toolName" -> "bash".asJson, "reason" -> "hook".asJson)
      )
    ).head
    asked.hcursor.get[String]("type").toOption.get shouldBe "approval/requested"
    asked.hcursor.get[String]("approvalId").toOption.get shouldBe "e1"
    asked.hcursor.get[String]("rpcId").toOption.get shouldBe "e1"
    asked.hcursor.get[String]("toolName").toOption.get shouldBe "bash"

    val q = projectEvents(
      Json.obj(
        "type" -> "waterfall".asJson,
        "event" -> "user-questions/request".asJson,
        "eventId" -> "q1".asJson,
        "agentId" -> "s1".asJson,
        "request" -> Json.obj("questions" -> Json.arr())
      )
    ).head
    q.hcursor.get[String]("type").toOption.get shouldBe "question/requested"
    q.hcursor.get[String]("rpcId").toOption.get shouldBe "q1"

    val err = projectEvents(
      Json.obj(
        "type" -> "emit".asJson,
        "event" -> "api-session/error".asJson,
        "args" -> Json.arr("s1".asJson, "boom".asJson)
      )
    ).head
    err.hcursor.get[String]("type").toOption.get shouldBe "host/agent-error"
    err.hcursor.get[String]("message").toOption.get shouldBe "boom"

  test("control baseline fans out into session queue/jobs/projection frames"):
    val frames = projectControl(
      Json.obj(
        "type" -> "baseline".asJson,
        "value" -> Json.obj(
          "queues" -> Json.obj("s1" -> Json.arr(Json.obj("id" -> "i1".asJson))),
          "jobs" -> Json.obj("s1" -> Json.arr()),
          "projections" -> Json.obj(
            "s1" -> Json.obj("values" -> Json.obj("imageLimits" -> Json.obj("maxBytes" -> Json.fromLong(1))))
          )
        )
      )
    )
    frames.map(_.hcursor.get[String]("type").toOption.get).toSet shouldBe
      Set("session/queue", "session/jobs", "session/projection")

  test("event result maps Fast outcome strings onto $events/result args"):
    val allow = eventResultArgs("c1", "e1", Json.obj("outcome" -> "allowed-once".asJson), rejected = false)
    allow.hcursor.get[String]("clientId").toOption.get shouldBe "c1"
    allow.hcursor.get[String]("eventId").toOption.get shouldBe "e1"
    allow.hcursor.downField("outcome").get[String]("kind").toOption.get shouldBe "result"
    allow.hcursor.downField("outcome").get[String]("value").toOption.get shouldBe "allowed-once"

    val deny = eventResultArgs("c1", "e1", Json.obj(), rejected = true)
    deny.hcursor.downField("outcome").get[String]("kind").toOption.get shouldBe "rejected"
    deny.hcursor.downField("outcome").downField("error").get[String]("name").toOption.get shouldBe "Error"
