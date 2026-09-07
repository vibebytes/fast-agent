package ai.fastllm.agent.dsh.proc

import ai.fastllm.agent.dsh.DshRoots
import ai.fastllm.agent.engine.EngineId
import io.circe.Json

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

final case class TokenSource(token: Option[String], from: Option[String], probed: List[String])

/** Probe order (§5.2): config.token → config.tokenFile → fast.dsh.token → FAST_DSH_TOKEN → root1/.token → root2/.token. */
def sources(
    config: Option[Map[String, Json]] = None,
    props: Map[String, String] = sys.props.toMap,
    env: Map[String, String] = sys.env.toMap
): TokenSource =
  val probed = List.newBuilder[String]
  var found: Option[(String, String)] = None
  def consider(label: String, raw: Option[String]): Unit =
    if found.isEmpty then
      probed += label
      raw.flatMap(normalize).foreach: t =>
        found = Some(label -> t)
  val cfg = config.getOrElse(Map.empty)
  consider("config.token", cfg.get("token").flatMap(_.asString))
  cfg.get("tokenFile").flatMap(_.asString).map(_.trim).filter(_.nonEmpty).foreach: p =>
    val raw = readFile(Path.of(p))
    val label = if raw.isDefined then s"config.tokenFile=$p" else s"config.tokenFile=$p(missing)"
    consider(label, raw)
  consider("fast.dsh.token", props.get("fast.dsh.token"))
  consider("FAST_DSH_TOKEN", env.get("FAST_DSH_TOKEN"))
  val (root1, root2) = rootsOf(props, env)
  consider(s"${root1}/.token", readFile(root1.resolve(".token")))
  if root2 != root1 then consider(s"${root2}/.token", readFile(root2.resolve(".token")))
  found match
    case Some((from, t)) => TokenSource(Some(t), Some(from), probed.result())
    case None            => TokenSource(None, None, probed.result())

/** Explicit sources (first four) are pinned into a spawned child env; file sources are not. */
def explicitSource(from: String): Boolean =
  List("config.token", "config.tokenFile", "fast.dsh.token", "FAST_DSH_TOKEN").exists(from.startsWith)

/** `fast.dsh.token` / `FAST_DSH_TOKEN` / engines/dsh/.token, or a pasted `/?token=` URL. */
def launchToken: Option[String] = sources(None).token

private def normalize(raw: String): Option[String] =
  val t = raw.trim
  if t.isEmpty then None
  else TokenQ.findFirstMatchIn(t).map(_.group(1)).orElse:
    if t.contains("://") then None else Some(t)

private def readFile(p: Path): Option[String] =
  try
    if Files.isRegularFile(p) then Some(Files.readString(p).trim)
    else None
  catch case NonFatal(_) => None

private def rootsOf(props: Map[String, String], env: Map[String, String]): (Path, Path) =
  val home = props.getOrElse("user.home", ".")
  val runtime = props.get("fast.runtime.root").orElse(env.get("FAST_RUNTIME_ROOT"))
  val root1 = DshRoots.at(EngineId("dsh"), runtime, home)
  val root2 = DshRoots.at(EngineId("dsh"), None, home)
  (root1, root2)

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
class DshProcess private (attach: Option[Int], argv: List[String], config: Option[Map[String, Json]] = None):
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
        val ts = sources(config)
        ts.token match
          case Some(t) =>
            rememberToken(t)
            tokenP.trySuccess(Some(t))
          case None =>
            tokenP.tryFailure(RuntimeException(s"dsh token missing (probed: ${ts.probed.mkString(", ")})"))
      case None =>
        if argv.isEmpty then
          portP.tryFailure(IllegalStateException("FAST_DSH_COMMAND empty"))
          tokenP.trySuccess(None)
        else
          val pb = ProcessBuilder(argv*)
          val ts = sources(config)
          if ts.from.exists(explicitSource) then
            ts.token.foreach: t =>
              pb.environment().put("FAST_DSH_TOKEN", t)
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
  def attach(port: Int, config: Option[Map[String, Json]] = None): DshProcess = DshProcess(Some(port), Nil, config)
  def spawn(argv: List[String], config: Option[Map[String, Json]] = None): DshProcess = DshProcess(None, argv, config)
  def spawn(command: String): DshProcess = spawn(argvOf(command))

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
