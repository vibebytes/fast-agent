package ai.fastllm.fast.tools

import ai.fastllm.agent.ext.{Extension, ExtensionContext, ExtensionId}

final class FastTools extends Extension:
  def id: ExtensionId = ExtensionId("tools")

  def install(ctx: ExtensionContext): Unit =
    ctx.tools.add(ClockNow)
    ctx.tools.add(ConfigProbe)
