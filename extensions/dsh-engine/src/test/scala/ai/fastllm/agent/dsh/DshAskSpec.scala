package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.{Admit, AgentAttachProtocol, AgentLoop, Caps, ChannelMessageWindow, EventRow, RouteResult, dshQueuedOnto}
import ai.fastllm.agent.engine.{EngineId, EngineIds, EngineSwitch}
import ai.fastllm.agent.remote.Client
import io.circe.Json
import io.circe.parser.parse
import io.circe.syntax.*
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import scala.concurrent.ExecutionContext
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.{Await, Future, Promise}
import scala.concurrent.duration.*
import scala.io.Source

/** DshLoopSpec — question / approval. Loaded by DshLoopSpec. */
trait DshAskSpec:
  this: AnyFunSuite & Matchers & DshLoopKit =>

  test("question/requested lands QuestionBatchRequested; answer posts envelope rpcId; resolved waits for mux"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitQuestion(
      Sid,
      "rpc-q",
      Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson, "options" -> Json.arr(Json.obj("label" -> "Yes".asJson))))
    )
    payloadTypes(await(loop.events(Sid, 0))) should contain("QuestionBatchRequested")
    loop.busy(Sid) shouldBe true
    val answered = await(
      loop.answer(
        AgentAttachProtocol.Command.AnswerQuestionBatch(
          Sid,
          "rpc-q",
          List(AgentAttachProtocol.Command.QuestionBatchAnswer("q1", List("Yes")))
        )
      )
    )
    answered.status shouldBe "accepted"
    remote.replies.map(_._1) shouldBe Vector("rpc-q")
    remote.replies.head._2.hcursor.downField("answer").downField("answers").as[List[Json]].toOption.get.head
      .hcursor.get[String]("id").toOption.get shouldBe "q1"
    payloadTypes(await(loop.events(Sid, 0))) should not contain "QuestionBatchResolved"
    remote.emitQuestionDone(Sid, "rpc-q", "answered")
    payloadTypes(await(loop.events(Sid, 0))) should contain("QuestionBatchResolved")
    loop.busy(Sid) shouldBe true

  test("same question rpcId replay emits again; unknown rpc rejected; cancel uses replyCancel"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    val qs = Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson))
    remote.emitQuestion(Sid, "rpc-q", qs)
    remote.emitQuestion(Sid, "rpc-q", qs)
    payloadTypes(await(loop.events(Sid, 0))).count(_ == "QuestionBatchRequested") shouldBe 2
    await(loop.answer(AgentAttachProtocol.Command.AnswerQuestionBatch(Sid, "missing", Nil))) shouldBe
      RouteResult("rejected", "", "no pending question")
    await(loop.answer(AgentAttachProtocol.Command.AnswerQuestionBatch(Sid, "rpc-q", Nil, cancelled = true))).status shouldBe
      "accepted"
    remote.cancels shouldBe Vector("rpc-q")
  test("approval asked → card; decide posts envelope rpcId; river waits for mux resolved"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitAsked(Sid, "rpc-1", "ap-1", "bash", Some("sandbox"), Some("call-9"))
    val asked = await(loop.events(Sid, 0)).last
    payloadType(asked) shouldBe "ApprovalRequested"
    payloadString(asked, "tool") shouldBe "shell"
    payloadString(asked, "risk") shouldBe "shell"
    payloadString(asked, "description") shouldBe "sandbox"
    payloadString(asked, "context") shouldBe ""
    payloadString(asked, "note") shouldBe "sandbox"
    payloadString(asked, "runId") shouldBe s"$Sid:c1"
    await(loop.decide(AgentAttachProtocol.Command.DecideApproval(Sid, s"$Sid:c1", "ap-1", approved = true))) shouldBe
      RouteResult("accepted", s"$Sid:c1", "")
    remote.replies should have size 1
    remote.replies.head._1 shouldBe "rpc-1"
    remote.replies.head._2.hcursor.get[String]("outcome").toOption.get shouldBe "allowed-once"
    payloadTypes(await(loop.events(Sid, 0))).count(_ == "ApprovalResolved") shouldBe 0
    remote.emitDone(Sid, "ap-1", "allowed-once")
    payloadTypes(await(loop.events(Sid, 0))).last shouldBe "ApprovalResolved"
    await(loop.decide(AgentAttachProtocol.Command.DecideApproval(Sid, s"$Sid:c1", "ap-1", approved = false))) shouldBe
      RouteResult("rejected", "", "no pending approval")

  test("write outside workspace uses external_directory and file_path, never callId"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(
      Sid,
      ev(
        "tool/call",
        1,
        """{"turn":1,"callId":"call-w","name":"write","arguments":"{\"file_path\":\"/tmp/out.txt\",\"content\":\"hi\"}"}"""
      )
    )
    remote.emitAsked(
      Sid,
      "rpc-w",
      "ap-w",
      "write",
      Some("escalate sandbox to danger-full-access: absolute path outside the session workspace"),
      Some("call-w")
    )
    val asked = await(loop.events(Sid, 0)).last
    payloadString(asked, "tool") shouldBe "write_file"
    payloadString(asked, "risk") shouldBe "external_directory"
    payloadString(asked, "context") shouldBe "/tmp/out.txt"
    payloadString(asked, "description") should include("outside")
    payloadString(asked, "note") should include("outside")

  test("write without escalate is workspace_write; missing tool/call leaves context empty"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitAsked(Sid, "rpc-w2", "ap-w2", "write", Some("write a file"), Some("call-missing"))
    val asked = await(loop.events(Sid, 0)).last
    payloadString(asked, "tool") shouldBe "write_file"
    payloadString(asked, "risk") shouldBe "workspace_write"
    payloadString(asked, "context") shouldBe ""
    payloadString(asked, "description") shouldBe "write a file"
    payloadString(asked, "note") shouldBe "write a file"

  test("unknown approvalId does not respond"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    await(loop.decide(AgentAttachProtocol.Command.DecideApproval(Sid, s"$Sid:c1", "ghost", approved = true))) shouldBe
      RouteResult("rejected", "", "no pending approval")
    remote.replies shouldBe empty

  test("decide reject maps to DSH rejected; cancelled mux expires the card"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitAsked(Sid, "rpc-2", "ap-2", "write")
    await(loop.decide(AgentAttachProtocol.Command.DecideApproval(Sid, s"$Sid:c1", "ap-2", approved = false)))
      .status shouldBe "accepted"
    remote.replies.head._2.hcursor.get[String]("outcome").toOption.get shouldBe "rejected"
    remote.emitDone(Sid, "ap-2", "cancelled")
    payloadString(await(loop.events(Sid, 0)).last, "type") shouldBe "ApprovalExpired"
    payloadString(await(loop.events(Sid, 0)).last, "reason") shouldBe "cancelled"

  test("replay of the same approvalId updates rpcId and does not duplicate the card"):
    val remote = FakeClient()
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitAsked(Sid, "rpc-old", "ap-3", "bash")
    remote.emitAsked(Sid, "rpc-new", "ap-3", "bash")
    payloadTypes(await(loop.events(Sid, 0))).count(_ == "ApprovalRequested") shouldBe 1
    await(loop.decide(AgentAttachProtocol.Command.DecideApproval(Sid, s"$Sid:c1", "ap-3", approved = true)))
    remote.replies.map(_._1) shouldBe Vector("rpc-new")

  test("respond not-pending stays pending until mux resolved"):
    val remote = FakeClient()
    remote.replyFail = Some("not-pending")
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitAsked(Sid, "rpc-4", "ap-4", "bash")
    await(loop.decide(AgentAttachProtocol.Command.DecideApproval(Sid, s"$Sid:c1", "ap-4", approved = true))) shouldBe
      RouteResult("rejected", "", "not-pending")
    payloadTypes(await(loop.events(Sid, 0))).count(_ == "ApprovalResolved") shouldBe 0
  test("child question reply uses child sessionId and echoed rpcId"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emitQuestion(
      "child-1",
      "rpc-q",
      Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson, "options" -> Json.arr(Json.obj("label" -> "Yes".asJson))))
    )
    payloadString(await(loop.events(Sid, 0)).find(r => payloadType(r) == "QuestionBatchRequested").get, "rpcId") shouldBe
      "rpc-q"
    parse(await(loop.events(Sid, 0)).find(r => payloadType(r) == "QuestionBatchRequested").get.envelopeJson).toOption.get
      .hcursor.downField("payload").get[String]("type").toOption.get shouldBe "QuestionBatchRequested"
    await(
      loop.answer(
        AgentAttachProtocol.Command.AnswerQuestionBatch(
          Sid,
          "rpc-q",
          List(AgentAttachProtocol.Command.QuestionBatchAnswer("q1", List("Yes")))
        )
      )
    ).status shouldBe "accepted"
    remote.replies.map(_._1) shouldBe Vector("rpc-q")
    remote.replies.head._2.hcursor.get[String]("sessionId").toOption.get shouldBe "child-1"

  test("child approval reply uses child sessionId"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "one-shot"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emitAsked("child-1", "rpc-a", "ap-1", "bash")
    await(loop.decide(AgentAttachProtocol.Command.DecideApproval(Sid, "r", "ap-1", approved = true)))
    remote.replies.head._2.hcursor.get[String]("sessionId").toOption.get shouldBe "child-1"

  test("child question cancel uses replyCancel only"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emitQuestion(
      "child-1",
      "rpc-q",
      Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson, "options" -> Json.arr(Json.obj("label" -> "Yes".asJson))))
    )
    await(
      loop.answer(AgentAttachProtocol.Command.AnswerQuestionBatch(Sid, "rpc-q", Nil, cancelled = true))
    ).status shouldBe "accepted"
    remote.cancels shouldBe Vector("rpc-q")
    remote.replies shouldBe empty

  test("answer RouteResult targetId is empty when parent run is over"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/end", 1, """{"turn":1,"reason":{"kind":"completed"}}"""))
    remote.emit("child-1", ev("turn/start", 2, """{"turn":1}"""))
    remote.emitQuestion(
      "child-1",
      "rpc-q",
      Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson, "options" -> Json.arr(Json.obj("label" -> "Yes".asJson))))
    )
    val result = await(
      loop.answer(
        AgentAttachProtocol.Command.AnswerQuestionBatch(
          Sid,
          "rpc-q",
          List(AgentAttachProtocol.Command.QuestionBatchAnswer("q1", List("Yes")))
        )
      )
    )
    result shouldBe RouteResult("accepted", "", "")

  test("pending question is one clump"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "running", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emitSubscribed(Sid, 0)
    remote.emitQuestion(
      "child-1",
      "rpc-q",
      Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson, "options" -> Json.arr(Json.obj("label" -> "Yes".asJson))))
    )
    await(
      loop.answer(
        AgentAttachProtocol.Command.AnswerQuestionBatch(
          Sid,
          "rpc-q",
          List(AgentAttachProtocol.Command.QuestionBatchAnswer("q1", List("Yes")))
        )
      )
    ).status shouldBe "accepted"
    val again = await(
      loop.answer(
        AgentAttachProtocol.Command.AnswerQuestionBatch(
          Sid,
          "rpc-q",
          List(AgentAttachProtocol.Command.QuestionBatchAnswer("q1", List("Yes")))
        )
      )
    )
    again.status shouldBe "rejected"
    again.detail shouldBe "no pending question"

  test("running child does not set busy; child question does"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "inactive", "continuable", "bg"))
    val loop = DshLoop(remote, _ => Cwd)
    await(loop.submit(submit("c1", "hi")))
    remote.emit(Sid, ev("turn/end", 1, """{"turn":1,"reason":{"kind":"completed"}}"""))
    remote.emit("child-1", ev("turn/start", 2, """{"turn":1}"""))
    loop.busy(Sid) shouldBe false
    remote.emitQuestion(
      "child-1",
      "rpc-q",
      Json.arr(Json.obj("id" -> "q1".asJson, "question" -> "Go?".asJson, "options" -> Json.arr(Json.obj("label" -> "Yes".asJson))))
    )
    loop.busy(Sid) shouldBe true

  test("onChildOpen fires when child opens and parent is idle"):
    val remote = FakeClient()
    remote.list = catalog(childEntry("child-1", "inactive", "continuable", "bg"))
    var opened = Vector.empty[String]
    val loop = DshLoop(remote, _ => Cwd, onChildOpen = sid => opened = opened :+ sid)
    await(loop.submit(submit("c1", "hi")))
    remote.emit("child-1", ev("turn/start", 1, """{"turn":1}"""))
    opened shouldBe empty
    remote.emit(Sid, ev("turn/end", 2, """{"turn":1,"reason":{"kind":"completed"}}"""))
    remote.emit("child-1", ev("turn/start", 3, """{"turn":1}"""))
    opened shouldBe Vector(Sid)
