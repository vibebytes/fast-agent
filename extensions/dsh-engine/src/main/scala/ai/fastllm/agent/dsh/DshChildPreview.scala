package ai.fastllm.agent.dsh

import io.circe.Json

val previewCap = 4 * 1024
val previewThrottleMs = 100L

enum PreviewEmit:
  case Immediate, Throttled, Hold

def previewEmit(activityChanged: Boolean, lastEmitMs: Option[Long], nowMs: Long): PreviewEmit =
  if activityChanged || lastEmitMs.isEmpty then PreviewEmit.Immediate
  else if nowMs - lastEmitMs.get < previewThrottleMs then PreviewEmit.Hold
  else PreviewEmit.Throttled

def clipPreview(buf: String): String =
  if buf.length <= previewCap then buf else buf.takeRight(previewCap)

def joinPreview(buf: String, delta: String, tpe: String): String =
  val line = tpe == "tool/call" || tpe == "tool/result"
  if line then
    val base = if buf.isEmpty then "" else if buf.endsWith("\n") then buf else s"$buf\n"
    s"$base$delta\n"
  else if buf.isEmpty then delta
  else s"$buf$delta"

def dshPreviewDelta(data: Json, tpe: String): Option[String] =
  tpe match
    case "tool/call" => Some(toolCallLine(data))
    case "tool/result" => toolResultLine(data)
    case "assistant/chunk" =>
      val chunk = data.hcursor.downField("chunk").focus.getOrElse(Json.obj())
      chunk.hcursor.get[String]("type").toOption match
        case Some("text-delta") => chunk.hcursor.get[String]("text").toOption.filter(_.nonEmpty)
        case _ => None
    case _ => None

private def toolCallLine(data: Json): String =
  val name = dshTool(data.hcursor.get[String]("name").toOption.getOrElse(""))
  val args = flatArgs(data.hcursor.get[String]("arguments").toOption.getOrElse(""))
  name match
    case "shell" =>
      val cmd = args.get("command").orElse(dshContext(args)).getOrElse("").trim
      if cmd.nonEmpty then s"$$ $cmd" else "shell"
    case other =>
      val target = dshContext(args).getOrElse("").trim
      if target.nonEmpty then s"$other $target" else other

private def toolResultLine(data: Json): Option[String] =
  val blocks = data.hcursor.downField("message").downField("content").as[List[Json]].toOption.getOrElse(Nil)
  val output = blocks.flatMap: b =>
    b.hcursor.downField("content").as[List[Json]].toOption.getOrElse(Nil).flatMap: inner =>
      inner.hcursor.get[String]("text").toOption
  .mkString
  val failed =
    data.hcursor.downField("error").focus.exists(e => !e.isNull)
      || blocks.exists(_.hcursor.get[Boolean]("isError").toOption.contains(true))
  if failed then Some(if output.isEmpty then "failed" else s"failed\n$output")
  else Option(output).filter(_.nonEmpty)
