package ai.fastllm.fast.vibe3d

import ai.fastllm.agent.ext.{Extension, ExtensionContext, ExtensionId}
import org.slf4j.LoggerFactory

import java.time.Duration
import java.util.UUID
import scala.util.Try

/** Thin shell: start the daemon, hand the host a stdio MCP server and a panel url. No scenes, no
  * tools, no editor code — those live in the vibe3d repo.
  */
final class Vibe3dExtension(runtime: Vibe3dRuntime) extends Extension:
  def this() = this(Vibe3dProcess())

  private val log = LoggerFactory.getLogger(getClass)
  private var health: Option[Vibe3dHealth] = None
  private var listener: Option[Vibe3dOpenListener.Handle] = None

  def id: ExtensionId = ExtensionId("vibe3d")

  def install(ctx: ExtensionContext): Unit =
    stopHealth()
    stopListener()
    Vibe3dConfig.optional(ctx.config) match
      case None =>
        log.info("[vibe3d] no checkout on this machine, extension idle")
        ctx.events.publish(Vibe3dPlan.StateTopic, Vibe3dPlan.state("down", "no checkout"))
      case Some(Left(why)) =>
        ctx.events.publish(Vibe3dPlan.StateTopic, Vibe3dPlan.state("error", why))
        throw IllegalStateException(why)
      case Some(Right(cfg)) =>
        val effective = withNotify(cfg, ctx)
        val live = runtime.start(effective).fold(
          why =>
            ctx.events.publish(Vibe3dPlan.StateTopic, Vibe3dPlan.state("error", why))
            throw IllegalStateException(why),
          identity
        )
        val plan = Vibe3dPlan.of(effective, live, effective.editorUrl(live.port, live.token))
        ctx.mcp.upsert(plan.mcp)
        ctx.ui.surface(plan.surface)
        ctx.events.publish(Vibe3dPlan.OpenTopic, plan.open)
        ctx.events.publish(Vibe3dPlan.StateTopic, Vibe3dPlan.state("ready", live.baseUrl))
        health = Some(watch(ctx, effective, live))
        log.info("[vibe3d] installed pid={} port={}", live.pid, live.port)

  override def uninstall(): Unit =
    stopHealth()
    stopListener()
    runtime.stop()

  /** The daemon pushes one open intent per `room.create`; the panel follows the working room. */
  private def withNotify(cfg: Vibe3dConfig, ctx: ExtensionContext): Vibe3dConfig =
    val notifyToken = UUID.randomUUID().toString
    Try(
      Vibe3dOpenListener.start(
        notifyToken,
        (url, roomId) =>
          roomId match
            case Some(id) => ctx.events.publish(Vibe3dPlan.OpenTopic, Vibe3dPlan.openRoom(url, id))
            case None     => log.warn("[vibe3d] open notify without a roomId: {}", url)
      )
    ).fold(
      why =>
        log.warn("[vibe3d] open listener unavailable, panel will not follow room.create: {}", why)
        cfg,
      h =>
        listener = Some(h)
        cfg.withNotifyEndpoint(s"http://127.0.0.1:${h.port}/vibe3d/opens?k=$notifyToken")
    )

  private def stopListener(): Unit =
    listener.foreach(_.stop())
    listener = None

  private def watch(ctx: ExtensionContext, cfg: Vibe3dConfig, live: Vibe3dRuntime.Live): Vibe3dHealth =
    val client = Vibe3dRuntime.healthClient
    var base = live.baseUrl
    val monitor = Vibe3dHealth(
      () => Vibe3dRuntime.healthy(client, base, Duration.ofSeconds(2)),
      (state, detail) => ctx.events.publish(Vibe3dPlan.StateTopic, Vibe3dPlan.state(state, detail)),
      live.baseUrl,
      () =>
        log.warn("[vibe3d] daemon down, restarting")
        runtime.start(cfg) match
          case Right(fresh) =>
            base = fresh.baseUrl
            val plan = Vibe3dPlan.of(cfg, fresh, cfg.editorUrl(fresh.port, fresh.token))
            ctx.mcp.upsert(plan.mcp)
            ctx.ui.surface(plan.surface)
            ctx.events.publish(Vibe3dPlan.OpenTopic, plan.open)
            log.info("[vibe3d] daemon recovered pid={} port={}", fresh.pid, fresh.port)
            Some(fresh.baseUrl)
          case Left(why) =>
            log.warn("[vibe3d] daemon restart failed: {}", why)
            None
    )
    monitor.start()
    monitor

  private def stopHealth(): Unit =
    health.foreach(_.stop())
    health = None
