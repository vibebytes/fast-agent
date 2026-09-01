package ai.fastllm.agent.dsh

import ai.fastllm.agent.remote.Client
import io.circe.Json
import io.circe.syntax.*

import scala.concurrent.{ExecutionContext, Future}

/** Session RPCs that need a live DSH session before the call. */
val BindFirst: Set[String] =
  Set("session.models", "session.selectModel", "skill.list", "agentPreset.select")

/** Host-facing DSH unary hop. Shares `DshHttp` with `DshLoop`; not on `AgentLoop`. */
class DshFace(remote: Client, cwdOf: String => String, loop: DshLoop)(using ExecutionContext):
  def bind(sessionId: String, cwd: String): Future[Either[Json, Unit]] =
    loop.bind(sessionId, cwd)

  def dispatch(method: String, payload: Json, sessionId: Option[String]): Future[Json] =
    val sid = sessionId.map(_.trim).filter(_.nonEmpty).orElse:
      payload.hcursor.get[String]("sessionId").toOption.map(_.trim).filter(_.nonEmpty)
    val body =
      sid.filter(_ => payload.hcursor.get[String]("sessionId").toOption.forall(_.trim.isEmpty))
        .fold(payload)(id => payload.deepMerge(Json.obj("sessionId" -> id.asJson)))
    if method == "session.create" || BindFirst.contains(method) then
      sid match
        case None => Future.successful(failJson("bad-request", "sessionId required"))
        case Some(id) =>
          val cwd = cwdOf(id).trim
          if cwd.isEmpty then Future.successful(failJson("cwd missing", "cwd missing"))
          else
            remote.ready.flatMap(_ => bind(id, cwd)).flatMap:
              case Left(err) => Future.successful(Json.obj("ok" -> Json.False, "error" -> err))
              case Right(_) =>
                if method == "session.create" then
                  Future.successful(Json.obj("ok" -> Json.True, "value" -> Json.obj()))
                else remote.call(method, body)
    // Host RPCs (settings / credentials / llm / presets) are unary HTTP. Do not wait for mux —
    // a stuck ready() would swallow command_result and Hub times out at 12s.
    else remote.call(method, body)

def failJson(code: String, message: String): Json =
  Json.obj("ok" -> Json.False, "error" -> Json.obj("code" -> code.asJson, "message" -> message.asJson))
