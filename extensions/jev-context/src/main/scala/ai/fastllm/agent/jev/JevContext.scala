package ai.fastllm.agent.jev

import ai.fastllm.agent.ext.{Extension, ExtensionContext, ExtensionId}

final class JevContext extends Extension:
  def id: ExtensionId = ExtensionId("jev-context")

  def install(ctx: ExtensionContext): Unit =
    ctx.context.register("context.select", Selector(ctx.settings))
