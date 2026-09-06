package ai.fastllm.agent.dsh.proc

import ai.fastllm.agent.dsh.DshRoots

import java.io.{BufferedReader, InputStreamReader}
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.nio.file.attribute.PosixFilePermissions
import scala.concurrent.{Future, Promise}
import scala.util.control.NonFatal
import scala.util.matching.Regex

val Banner: Regex = """dsh web: http://127\.0\.0\.1:(\d+)""".r
val TokenQ: Regex = """[?&]token=([^&\s#]+)""".r
/** Official attach is 3080. Spawn command must be explicit (local bin or FAST_DSH_COMMAND); never `npx --yes`. */
val OfficialPort: Int = 3080
val DefaultCommand: String = ""

def portOf(line: String): Option[Int] =
  Banner.findFirstMatchIn(line).map(_.group(1).toInt)

def tokenOf(line: String): Option[String] =
  if Banner.findFirstIn(line).isEmpty then None
  else TokenQ.findFirstMatchIn(line).map(_.group(1))

def bannerOf(line: String): Option[(Int, Option[String])] =
  portOf(line).map(_ -> tokenOf(line))

/** `fast.dsh.token` / `FAST_DSH_TOKEN` / engines/dsh/.token, or a pasted `/?token=` URL. */
def launchToken: Option[String] =
  val raw = sys.props.get("fast.dsh.token")
    .orElse(sys.env.get("FAST_DSH_TOKEN"))
    .orElse(tokenFile)
    .map(_.trim)
    .filter(_.nonEmpty)
  raw.flatMap: v =>
    TokenQ.findFirstMatchIn(v).map(_.group(1)).orElse(Some(v))

def rememberToken(token: String): Unit =
  val t = token.trim
  if t.isEmpty then ()
  else
    sys.props.update("fast.dsh.token", t)
    try
      val root = DshRoots.of()
      Files.createDirectories(root)
      val dest = root.resolve(".token")
      Files.writeString(dest, t)
      lockToken(dest)
    catch
      case NonFatal(e) => System.err.println(s"dsh remember token: ${e.getMessage}")

private def tokenFile: Option[String] =
  try
    val p = DshRoots.of().resolve(".token")
    if Files.isRegularFile(p) then Some(Files.readString(p).trim)
    else None
  catch case NonFatal(_) => None

private def lockToken(dest: Path): Unit =
  try Files.setPosixFilePermissions(dest, PosixFilePermissions.fromString("rw-------"))
  catch case NonFatal(_) => ()

def argvOf(command: String): List[String] =
  val out = List.newBuilder[String]
  val cur = StringBuilder()
  var quote = false
  val s = command.trim
  var i = 0
  while i < s.length do
    s(i) match
      case '"' =>
        quote = !quote
      case c if c.isWhitespace && !quote =>
        if cur.nonEmpty then
          out += cur.toString
          cur.clear()
      case c =>
        cur.append(c)
    i += 1
  if cur.nonEmpty then out += cur.toString
  out.result()

/** Resident DSH process or an already-bound loopback port. Lifetime = JVM, not IDE client count. */
class DshProcess private (attach: Option[Int], argv: List[String]):
  private val lock = new AnyRef
  private val portP = Promise[Int]()
  private val tokenP = Promise[Option[String]]()
  private var started = false
  private var child: Option[Process] = None
  private var destroyCount = 0
  def attached: Boolean = attach.isDefined
  def destroys: Int = lock.synchronized(destroyCount)

  def port: Future[Int] =
    lock.synchronized:
      if !started then boot()
    portP.future

  def token: Future[Option[String]] =
    lock.synchronized:
      if !started then boot()
    tokenP.future

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
        tokenP.trySuccess(launchToken)
      case None =>
        if argv.isEmpty then
          portP.tryFailure(IllegalStateException("FAST_DSH_COMMAND empty"))
          tokenP.trySuccess(None)
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
        bannerOf(line).foreach: (p, tok) =>
          portP.trySuccess(p)
          tok.foreach(rememberToken)
          tokenP.trySuccess(tok)
        line = in.readLine()
      if !portP.isCompleted then
        portP.tryFailure(IllegalStateException("dsh exited before advertising a port"))
        tokenP.trySuccess(None)
      while line != null do line = in.readLine()
    catch
      case NonFatal(e) =>
        if !portP.isCompleted then portP.tryFailure(e)
        tokenP.trySuccess(None)
    finally in.close()

object DshProcess:
  def attach(port: Int): DshProcess = DshProcess(Some(port), Nil)
  def spawn(argv: List[String]): DshProcess = DshProcess(None, argv)
  def spawn(command: String = DefaultCommand): DshProcess = spawn(argvOf(command))

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
