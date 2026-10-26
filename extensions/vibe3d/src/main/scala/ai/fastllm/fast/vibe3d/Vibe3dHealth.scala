package ai.fastllm.fast.vibe3d

import org.slf4j.LoggerFactory

import scala.util.control.NonFatal

/** Watches `/health` after install and republishes `ext.vibe3d.surface.state` only when the answer
  * flips. Install already published `ready`, so the first healthy tick is silent; a daemon that
  * dies mid-session turns the pane into `down` instead of staying on the stale `ready`.
  *
  * A dead daemon is also restarted: on the first unhealthy tick (and again only after `retryMs`)
  * `recover()` runs; `Some(newUrl)` flips straight back to `ready` with the new url — the pane never
  * flickers through `down` for a successful restart. A flip that changes the url publishes even when
  * the state stays `ready`, so the chip never keeps pointing at a dead port.
  */
final class Vibe3dHealth(
    probe: () => Boolean,
    publish: (String, String) => Unit,
    detail: String,
    recover: () => Option[String] = () => None,
    intervalMs: Long = 5_000L,
    retryMs: Long = 30_000L,
    now: () => Long = () => System.currentTimeMillis()
):
  private val log = LoggerFactory.getLogger(getClass)
  @volatile private var running = true
  private var last = "ready"
  private var lastDetail = detail
  private var currentDetail = detail
  private var nextAttempt = 0L
  private val thread = new Thread(() => loop(), "vibe3d-health")
  thread.setDaemon(true)

  def start(): Unit = thread.start()

  def stop(): Unit =
    running = false
    thread.interrupt()

  private def loop(): Unit =
    while running do
      try Thread.sleep(intervalMs)
      catch case _: InterruptedException => ()
      if running then tick()

  def tick(): Unit = synchronized:
    if running then
      val healthy = try probe() catch case _: Exception => false
      if healthy then flip("ready", currentDetail)
      else if now() >= nextAttempt then
        nextAttempt = now() + retryMs
        val restarted =
          try recover()
          catch
            case _: InterruptedException => None
            case NonFatal(_)             => None
        restarted match
          case Some(url) =>
            log.info("[vibe3d] daemon recovered, url={}", url)
            currentDetail = url
            flip("ready", url)
          case None => flip("down", s"$currentDetail /health failed")

  private def flip(state: String, detail: String): Unit =
    if state != last || detail != lastDetail then
      last = state
      lastDetail = detail
      log.info("[vibe3d] surface state -> {} ({})", state, detail)
      publish(state, detail)
