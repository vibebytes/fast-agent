package ai.fastllm.fast.vibe3d

import ai.fastllm.agent.ext.{Extension, ExtensionContext, ExtensionId}
import org.slf4j.LoggerFactory

import java.time.Duration

/** Thin shell: start the daemon, hand the host a stdio MCP server and a panel url. No scenes, no
  * tools, no editor code — those live in the vibe3d repo.
  */
final class Vibe3dExtension(runtime: Vibe3dRuntime) extends Extension:
  def this() = this(Vibe3dProcess())

  private val log = LoggerFactory.getLogger(getClass)
  private var health: Option[Vibe3dHealth] = None

  def id: ExtensionId = ExtensionId("vibe3d")

  def install(ctx: ExtensionContext): Unit =
    stopHealth()
    Vibe3dConfig.optional(ctx.config) match
      case None =>
        log.info("[vibe3d] no checkout on this machine, extension idle")
        ctx.events.publish(Vibe3dPlan.StateTopic, Vibe3dPlan.state("down", "no checkout"))
      case Some(Left(why)) =>
        ctx.events.publish(Vibe3dPlan.StateTopic, Vibe3dPlan.state("error", why))
        throw IllegalStateException(why)
      case Some(Right(cfg)) =>
        val live = runtime.start(cfg).fold(
          why =>
            ctx.events.publish(Vibe3dPlan.StateTopic, Vibe3dPlan.state("error", why))
            throw IllegalStateException(why),
          identity
        )
        val plan = Vibe3dPlan.of(cfg, live, cfg.editorUrl(live.port, live.token))
        ctx.mcp.upsert(plan.mcp)
        ctx.ui.surface(plan.surface)
        ctx.events.publish(Vibe3dPlan.OpenTopic, plan.open)
        ctx.events.publish(Vibe3dPlan.StateTopic, Vibe3dPlan.state("ready", live.baseUrl))
        health = Some(watch(ctx, live))
        log.info("[vibe3d] installed pid={} port={}", live.pid, live.port)

  override def uninstall(): Unit =
    stopHealth()
    runtime.stop()

  private def watch(ctx: ExtensionContext, live: Vibe3dRuntime.Live): Vibe3dHealth =
    val client = Vibe3dRuntime.healthClient
    val monitor = Vibe3dHealth(
      () => Vibe3dRuntime.healthy(client, live.baseUrl, Duration.ofSeconds(2)),
      (state, detail) => ctx.events.publish(Vibe3dPlan.StateTopic, Vibe3dPlan.state(state, detail)),
      live.baseUrl
    )
    monitor.start()
    monitor

  private def stopHealth(): Unit =
    health.foreach(_.stop())
    health = None
