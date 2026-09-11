package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.ChannelMessageWindow
import ai.fastllm.agent.dsh.proc.{DshProcess, launchToken}
import org.scalatest.funsuite.AnyFunSuite

import java.net.{InetAddress, ServerSocket}
import java.nio.file.{Files, Path}
import scala.collection.mutable.ListBuffer
import scala.concurrent.Await
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.*
import scala.util.{Failure, Success, Try}

/** Real cold start: a freshly spawned dsh host that has never bound the session.
 *  Run against an isolated store (`DSH_HOME=<copy of ~/.dsh>`) with COLD_CLI (local dsh bin) +
 *  node >= 22.19 and COLD_SID/COLD_CWD; cancels otherwise. */
final class DshColdStartLiveSpec extends AnyFunSuite:
  private val node = sys.env.getOrElse("COLD_NODE", "node")
  private val cli = sys.env.getOrElse("COLD_CLI", "")
  private val sid = sys.env.getOrElse("COLD_SID", "")
  private val cwd = sys.env.getOrElse("COLD_CWD", "")
  private val marker = sys.env.getOrElse("COLD_MARKER", "")

  private def freePort(): Int =
    val s = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    try s.getLocalPort
    finally s.close()

  private def boot(port: Int): DshProcess =
    val proc = DshProcess.spawn(
      List(node, cli, "web", "--host", "127.0.0.1", "--port", port.toString, "--no-open")
    )
    Await.result(proc.port, 60.seconds)
    Await.result(proc.token, 10.seconds)
    proc

  private def frame(loop: DshLoop, t0: Long): (String, Int, String) =
    val started = System.currentTimeMillis()
    val r = Try(Await.result(loop.restore(sid, Option.empty[String], 50), 30.seconds))
    val ms = System.currentTimeMillis() - t0
    r match
      case Success(w) =>
        val hit = marker.nonEmpty && w.rows.exists(_.content.exists(_.contains(marker)))
        val kind = if w.rows.isEmpty then "blank" else "rows"
        (kind, w.rows.size, s"${ms}ms/${System.currentTimeMillis() - started}ms $kind=${w.rows.size} marker=$hit")
      case Failure(e) =>
        val msg = Option(e.getMessage).getOrElse(e.toString)
        val kind = if msg.contains("dsh-pending") then "pending" else "fail"
        (kind, 0, s"${ms}ms $kind=${msg.take(48)}")

  private def settle(loop: DshLoop, t0: Long, budget: Int): (Int, List[String]) =
    val log = ListBuffer.empty[String]
    var rows = 0
    var i = 0
    while i < budget && rows == 0 do
      val (_, n, line) = frame(loop, t0)
      log += line
      rows = n
      if rows == 0 then Thread.sleep(500)
      i += 1
    (rows, log.toList)

  test("cold boot paints the stored transcript, never an empty window"):
    if cli.isEmpty || sid.isEmpty || cwd.isEmpty then
      org.scalatest.Assertions.cancel("set COLD_CLI/COLD_SID/COLD_CWD (+COLD_NODE) to run the live cold start")
    Files.createDirectories(Path.of(cwd))
    val port = freePort()
    val live = LiveDsh(port, Some(boot(port)), launchToken)
    val loop = new DshLoop(live.http(muxReadySec = 2), _ => cwd)
    try
      val t0 = System.currentTimeMillis()
      val (rows, log) = settle(loop, t0, 12)
      println(s"[cold-live] cold boot: ${log.mkString(" | ")}")
      assert(!log.exists(_.contains("blank=")), s"empty window on a cold host: ${log.mkString(" | ")}")
      assert(rows > 0, s"cold host never served the stored transcript: ${log.mkString(" | ")}")
    finally live.close()

  test("host restart under a bound loop still paints the stored transcript"):
    if cli.isEmpty || sid.isEmpty || cwd.isEmpty then
      org.scalatest.Assertions.cancel("set COLD_CLI/COLD_SID/COLD_CWD (+COLD_NODE) to run the live cold start")
    Files.createDirectories(Path.of(cwd))
    val port = freePort()
    val first = boot(port)
    val live = LiveDsh(port, Some(first), launchToken)
    val loop = new DshLoop(live.http(muxReadySec = 2), _ => cwd)
    try
      val t0 = System.currentTimeMillis()
      val (warm, warmLog) = settle(loop, t0, 12)
      assert(warm > 0, s"host A never served the transcript: ${warmLog.mkString(" | ")}")
      first.close()
      Thread.sleep(1.second.toMillis)
      val second = boot(port)
      try
        val (_, n, line) = frame(loop, t0)
        println(s"[cold-live] restart: warm=${warmLog.lastOption.getOrElse("")} then $line")
        assert(n > 0, s"restarted host rendered blank/pending under a bound loop: $line")
      finally second.close()
    finally live.close()
