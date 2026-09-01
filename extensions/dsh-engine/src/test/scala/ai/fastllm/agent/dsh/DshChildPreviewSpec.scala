package ai.fastllm.agent.dsh

import io.circe.parser.parse
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

class DshChildPreviewSpec extends AnyFunSuite with Matchers:

  test("tool/call read + path includes read_file and path"):
    val data = parse("""{"callId":"c1","name":"read","arguments":"{\"path\":\"src/A.scala\"}"}""").toOption.get
    val line = dshPreviewDelta(data, "tool/call").get
    line should include("read_file")
    line should include("src/A.scala")

  test("tool/call bash + command appears as $ or shell line"):
    val data = parse("""{"callId":"c1","name":"bash","arguments":"{\"command\":\"ls\"}"}""").toOption.get
    val line = dshPreviewDelta(data, "tool/call").get
    (line.startsWith("$ ") || line.contains("shell")) shouldBe true
    line should include("ls")

  test("tool/result success appends truncated output"):
    val data = parse(
      """{"message":{"content":[{"type":"tool-result","toolCallId":"c1","content":[{"type":"text","text":"a.txt"}]}]}}"""
    ).toOption.get
    dshPreviewDelta(data, "tool/result") shouldBe Some("a.txt")

  test("tool/result error / isError includes failed"):
    val data = parse(
      """{"message":{"content":[{"type":"tool-result","toolCallId":"c2","content":[{"type":"text","text":"nope"}],"isError":true}]},"error":{"name":"E"}}"""
    ).toOption.get
    val line = dshPreviewDelta(data, "tool/result").get
    line should include("failed")

  test("text-delta appends the original text"):
    val data = parse("""{"turn":1,"step":1,"chunk":{"type":"text-delta","index":0,"text":"Hello"}}""").toOption.get
    dshPreviewDelta(data, "assistant/chunk") shouldBe Some("Hello")

  test("reasoning-delta stays out of the tail"):
    val data = parse("""{"turn":1,"step":1,"chunk":{"type":"reasoning-delta","index":0,"text":"think"}}""").toOption.get
    dshPreviewDelta(data, "assistant/chunk") shouldBe None

  test("usage / subagent/descriptor / unknown type are None"):
    val usage = parse("""{"turn":1,"step":1,"chunk":{"type":"usage","usage":{"inputTokens":1}}}""").toOption.get
    dshPreviewDelta(usage, "assistant/chunk") shouldBe None
    dshPreviewDelta(parse("""{"inputTokens":1}""").toOption.get, "usage") shouldBe None
    dshPreviewDelta(parse("""{"version":2}""").toOption.get, "subagent/descriptor") shouldBe None
    dshPreviewDelta(parse("""{}""").toOption.get, "session/title") shouldBe None

  test("clipPreview keeps a 4KiB suffix"):
    val input = "x" * 5000
    val clipped = clipPreview(input)
    clipped.length should be <= 4096
    clipped shouldBe input.takeRight(clipped.length)
    clipped shouldBe input.substring(input.length - 4096)

  test("previewEmit: activity change and first delta are Immediate; else 100ms Hold/Throttled"):
    previewEmit(activityChanged = true, lastEmitMs = Some(0L), nowMs = 10L) shouldBe PreviewEmit.Immediate
    previewEmit(activityChanged = false, lastEmitMs = None, nowMs = 0L) shouldBe PreviewEmit.Immediate
    previewEmit(activityChanged = false, lastEmitMs = Some(0L), nowMs = 50L) shouldBe PreviewEmit.Hold
    previewEmit(activityChanged = false, lastEmitMs = Some(0L), nowMs = 100L) shouldBe PreviewEmit.Throttled
