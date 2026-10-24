package ai.fastllm.fast.vibe3d

import org.slf4j.LoggerFactory

import java.net.http.HttpClient
import java.time.Duration
import java.util.concurrent.TimeUnit
import scala.jdk.CollectionConverters.*

/** Owns the daemon child process. The MCP server is spawned by the host as a stdio server, so only
  * the daemon needs an explicit lifecycle here.
  */
final class Vibe3dProcess(awaitMs: Long = 20_000) extends Vibe3dRuntime:
  private val log = LoggerFactory.getLogger(getClass)
  private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build()
  private var proc: Option[Process] = None

  def start(cfg: Vibe3dConfig): Either[String, Vibe3dRuntime.Live] =
    stop()
    val builder = ProcessBuilder(cfg.daemonCommand.asJava)
    builder.redirectErrorStream(true)
    builder.redirectOutput(ProcessBuilder.Redirect.DISCARD)
    builder.environment().put("VIBE3D_HOME", cfg.home.toString)
    val child =
      try builder.start()
      catch case e: Exception => return Left(s"vibe3d daemon failed to spawn: ${e.getMessage}")
    proc = Some(child)
    await(cfg, child, Vibe3dDiscovery.read(cfg.home).map(_.pid).toSet)

  def stop(): Unit =
    proc.foreach: child =>
      child.descendants().forEach(_.destroy())
      child.destroy()
      if !child.waitFor(3, TimeUnit.SECONDS) then child.destroyForcibly()
      log.info("[vibe3d] daemon stopped pid={}", child.pid())
    proc = None

  private def await(cfg: Vibe3dConfig, child: Process, known: Set[Long]): Either[String, Vibe3dRuntime.Live] =
    val deadline = System.currentTimeMillis() + awaitMs
    var last = "daemon did not publish a run file"
    while System.currentTimeMillis() < deadline do
      if !child.isAlive then return Left(s"vibe3d daemon exited with code ${child.exitValue()}")
      val fresh = Vibe3dDiscovery.read(cfg.home).find(r => !known.contains(r.pid))
      Vibe3dDiscovery.byPid(cfg.home, child.pid()).orElse(fresh) match
        case Some(run) =>
          val base = s"http://127.0.0.1:${run.port}"
          if Vibe3dRuntime.healthy(client, base, Duration.ofSeconds(2)) then
            log.info("[vibe3d] daemon ready pid={} port={}", child.pid(), run.port)
            return Right(Vibe3dRuntime.Live(child.pid(), run.port, run.token))
          last = s"daemon listed port ${run.port} but /health failed"
        case None => ()
      Thread.sleep(100)
    Left(s"vibe3d daemon not ready in ${awaitMs}ms: $last")
