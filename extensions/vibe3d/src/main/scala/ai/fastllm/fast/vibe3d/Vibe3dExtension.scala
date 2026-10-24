package ai.fastllm.fast.vibe3d

import ai.fastllm.agent.ext.{Extension, ExtensionContext, ExtensionId}
import org.slf4j.LoggerFactory

/** Thin shell: start the daemon, hand the host a stdio MCP server and a panel url. No scenes, no
  * tools, no editor code — those live in the vibe3d repo.
  */
final class Vibe3dExtension(runtime: Vibe3dRuntime) extends Extension:
  def this() = this(Vibe3dProcess())

  private val log = LoggerFactory.getLogger(getClass)

  def id: ExtensionId = ExtensionId("vibe3d")

  def install(ctx: ExtensionContext): Unit =
    Vibe3dConfig.optional(ctx.config) match
      case None => log.info("[vibe3d] no checkout on this machine, extension idle")
      case Some(Left(why)) => throw IllegalStateException(why)
      case Some(Right(cfg)) =>
        val live = runtime.start(cfg).fold(why => throw IllegalStateException(why), identity)
        val plan = Vibe3dPlan.of(cfg, live, cfg.editorUrl(live.port, live.token))
        ctx.mcp.upsert(plan.mcp)
        ctx.ui.surface(plan.surface)
        ctx.events.publish(Vibe3dPlan.OpenTopic, plan.open)
        log.info("[vibe3d] installed pid={} port={}", live.pid, live.port)

  override def uninstall(): Unit = runtime.stop()
