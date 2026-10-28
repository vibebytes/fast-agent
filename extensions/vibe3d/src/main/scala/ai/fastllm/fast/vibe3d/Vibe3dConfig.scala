package ai.fastllm.fast.vibe3d

import io.circe.Json

import java.nio.file.{Files, Path, Paths}

/** Everything the shell needs to start the two node processes. `root` is the vibe3d checkout or
  * install dir; both entry points are built artifacts, never sources.
  */
final case class Vibe3dConfig(
    root: Path,
    node: String,
    home: Path,
    openEditor: Boolean,
    blockedTools: List[String],
    notifyEndpoint: Option[String] = None
):
  def daemonEntry: Path = root.resolve("packages/daemon/dist/index.js")

  def mcpEntry: Path = root.resolve("packages/mcp/dist/index.js")

  def missingEntries: List[Path] = List(daemonEntry, mcpEntry).filterNot(Files.isRegularFile(_))

  def withNotifyEndpoint(endpoint: String): Vibe3dConfig = copy(notifyEndpoint = Some(endpoint))

  def daemonCommand: List[String] =
    List(
      node,
      daemonEntry.toString,
      "--home",
      home.toString,
      "--open-editor",
      openEditor.toString,
      "--persist",
      "--log-level",
      "warn"
    ) ++ notifyEndpoint.toList.flatMap(e => List("--notify-opens", e))

  def mcpCommand(baseUrl: String, token: Option[String]): List[String] =
    List(node, mcpEntry.toString, "--url", baseUrl) ++
      token.filter(_.nonEmpty).toList.flatMap(t => List("--token", t)) ++
      List("--home", home.toString, "--autostart", "false")

  def editorUrl(port: Int, token: Option[String]): String =
    val base = s"http://127.0.0.1:$port/"
    token.filter(_.nonEmpty).fold(base)(t => s"$base?t=$t")

object Vibe3dConfig:
  private def str(cfg: Map[String, Json], key: String): Option[String] =
    cfg.get(key).flatMap(_.asString).map(_.trim).filter(_.nonEmpty)

  private def bool(cfg: Map[String, Json], key: String): Option[Boolean] = cfg.get(key).flatMap(_.asBoolean)

  private def list(cfg: Map[String, Json], key: String): List[String] =
    cfg.get(key).flatMap(_.asArray).getOrElse(Vector.empty).flatMap(_.asString).toList.map(_.trim).filter(_.nonEmpty)

  def rootOf(
      cfg: Map[String, Json],
      env: Map[String, String] = sys.env,
      cwd: Path = Paths.get(""),
      bundled: Option[Path] = defaultBundledRoot
  ): Path =
    val raw = str(cfg, "root").orElse(env.get("VIBE3D_ROOT").map(_.trim).filter(_.nonEmpty))
    val chosen = raw
      .map(Paths.get(_))
      .orElse(bundled.filter(b => Files.isDirectory(b)))
      .getOrElse(cwd.resolve("vibe3d"))
    chosen.toAbsolutePath.normalize

  private def defaultBundledRoot: Option[Path] =
    Option(System.getProperty("fast.extensions"))
      .map(_.trim)
      .filter(_.nonEmpty)
      .map(dir => Paths.get(dir).resolve("vibe3d"))

  def optional(
      cfg: Map[String, Json],
      env: Map[String, String] = sys.env,
      cwd: Path = Paths.get(""),
      bundled: Option[Path] = defaultBundledRoot
  ): Option[Either[String, Vibe3dConfig]] =
    if !Files.isDirectory(rootOf(cfg, env, cwd, bundled)) then None else Some(from(cfg, env, cwd, bundled))

  def from(
      cfg: Map[String, Json],
      env: Map[String, String] = sys.env,
      cwd: Path = Paths.get("").toAbsolutePath,
      bundled: Option[Path] = defaultBundledRoot
  ): Either[String, Vibe3dConfig] =
    val root = rootOf(cfg, env, cwd, bundled)
    val homeRaw = str(cfg, "home").orElse(env.get("VIBE3D_HOME").map(_.trim).filter(_.nonEmpty))
    val home = Paths.get(homeRaw.getOrElse(Paths.get(System.getProperty("user.home"), ".vibe3d", "fast").toString)).toAbsolutePath.normalize
    val conf = Vibe3dConfig(
      root = root,
      node = str(cfg, "node")
        .orElse(env.get("VIBE3D_NODE").map(_.trim).filter(_.nonEmpty))
        .orElse(env.get("FAST_NODE").map(_.trim).filter(_.nonEmpty))
        .getOrElse("node"),
      home = home,
      openEditor = bool(cfg, "openEditor").getOrElse(false),
      blockedTools = list(cfg, "blockedTools")
    )
    if !Files.isDirectory(root) then Left(s"vibe3d root not found: $root")
    else
      conf.missingEntries match
        case Nil => Right(conf)
        case missing => Left(s"vibe3d build missing: ${missing.mkString(", ")}")
