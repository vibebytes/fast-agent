package ai.fastllm.agent.dsh.proc

import java.io.{BufferedReader, InputStreamReader}
import java.nio.charset.StandardCharsets
import scala.concurrent.{Future, Promise}
import scala.util.control.NonFatal
import scala.util.matching.Regex

val Banner: Regex = """dsh web: http://127\.0\.0\.1:(\d+)""".r
/** Official attach is 3080. Spawn command must be explicit (local bin or FAST_DSH_COMMAND); never `npx --yes`. */
val OfficialPort: Int = 3080
val DefaultCommand: String = ""

def portOf(line: String): Option[Int] =
  Banner.findFirstMatchIn(line).map(_.group(1).toInt)

def argvOf(command: String): List[String] =
  command.trim.split("\\s+").toList.filter(_.nonEmpty)

/** Resident DSH process or an already-bound loopback port. Lifetime = JVM, not IDE client count. */
class DshProcess private (attach: Option[Int], command: Option[String]):
  private val lock = new AnyRef
  private val portP = Promise[Int]()
  private var started = false
  private var child: Option[Process] = None
  private var destroyCount = 0
  def attached: Boolean = attach.isDefined
  def destroys: Int = lock.synchronized(destroyCount)

  def port: Future[Int] =
    lock.synchronized:
      if !started then boot()
    portP.future

  def close(): Unit =
    lock.synchronized:
      child.foreach: p =>
        try
          p.destroy()
          destroyCount += 1
        catch case NonFatal(_) => ()
      child = None

  private def boot(): Unit =
    started = true
    attach match
      case Some(p) =>
        portP.trySuccess(p)
      case None =>
        val argv = argvOf(command.getOrElse(DefaultCommand))
        if argv.isEmpty then portP.tryFailure(IllegalStateException("FAST_DSH_COMMAND empty"))
        else
          val pb = ProcessBuilder(argv*)
          pb.redirectErrorStream(true)
          val proc = pb.start()
          child = Some(proc)
          val t = new Thread(() => drain(proc), "dsh-stdout")
          t.setDaemon(true)
          t.start()

  private def drain(proc: Process): Unit =
    val in = BufferedReader(InputStreamReader(proc.getInputStream, StandardCharsets.UTF_8))
    try
      var line = in.readLine()
      while line != null && !portP.isCompleted do
        portOf(line).foreach(portP.trySuccess)
        line = in.readLine()
      if !portP.isCompleted then
        portP.tryFailure(IllegalStateException("dsh exited before advertising a port"))
      while line != null do line = in.readLine()
    catch
      case NonFatal(e) =>
        if !portP.isCompleted then portP.tryFailure(e)
    finally in.close()

object DshProcess:
  def attach(port: Int): DshProcess = DshProcess(Some(port), None)
  def spawn(command: String = DefaultCommand): DshProcess = DshProcess(None, Some(command))

  /** Composition root: only when port or command is set. Official 3080 is `of`, not auto-enabled. */
  def wanted: Option[DshProcess] =
    val port =
      sys.props.get("fast.dsh.port").orElse(sys.env.get("FAST_DSH_PORT")).map(_.trim).filter(_.nonEmpty)
    val cmd = sys.env.get("FAST_DSH_COMMAND").map(_.trim).filter(_.nonEmpty)
    if port.isDefined || cmd.isDefined then of else None

  /** `fast.dsh.port` / `FAST_DSH_PORT` attaches; else `FAST_DSH_COMMAND` spawns; else official 3080. */
  def of: Option[DshProcess] =
    val port =
      sys.props.get("fast.dsh.port").orElse(sys.env.get("FAST_DSH_PORT")).map(_.trim).filter(_.nonEmpty)
    val cmd = sys.env.get("FAST_DSH_COMMAND").map(_.trim).filter(_.nonEmpty)
    (port, cmd) match
      case (Some(p), _)  => Some(attach(p.toInt))
      case (None, Some(c)) => Some(spawn(c))
      case _             => Some(attach(OfficialPort))
