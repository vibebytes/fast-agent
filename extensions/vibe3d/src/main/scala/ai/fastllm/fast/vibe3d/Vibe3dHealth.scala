package ai.fastllm.fast.vibe3d

import org.slf4j.LoggerFactory

/** Watches `/health` after install and republishes `ext.vibe3d.surface.state` only when the answer
  * flips. Install already published `ready`, so the first healthy tick is silent; a daemon that
  * dies mid-session turns the pane into `down` instead of staying on the stale `ready`.
  */
final class Vibe3dHealth(
    probe: () => Boolean,
    publish: (String, String) => Unit,
    detail: String,
    intervalMs: Long = 5_000L
):
  private val log = LoggerFactory.getLogger(getClass)
  @volatile private var running = true
  private var last = "ready"
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
      val next = if healthy then "ready" else "down"
      if next != last then
        last = next
        log.info("[vibe3d] surface state -> {}", next)
        publish(next, if next == "ready" then detail else s"$detail /health failed")
