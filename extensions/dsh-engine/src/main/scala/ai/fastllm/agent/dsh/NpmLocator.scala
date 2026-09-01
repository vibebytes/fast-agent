package ai.fastllm.agent.dsh

import java.io.File
import java.nio.file.{Files, Path, Paths}
import scala.jdk.CollectionConverters.*
import scala.util.Try

/** Resolve npm without relying on the launcher's PATH (GUI processes get a minimal PATH on macOS). */
object NpmLocator:
  val OverrideEnv: String = "FAST_NPM_COMMAND"

  def resolve(env: Map[String, String], home: Path, exists: Path => Boolean): Option[String] =
    overrideCommand(env)
      .orElse(candidateDirs(env, home).iterator.map(_.resolve("npm")).find(exists).map(_.toString))

  def overrideCommand(env: Map[String, String]): Option[String] =
    env.get(OverrideEnv).map(_.trim).filter(_.nonEmpty)

  def candidateDirs(env: Map[String, String], home: Path): Vector[Path] =
    val fromPath = env.get("PATH").toVector.flatMap(splitPath).map(Paths.get(_))
    val extras = Vector(
      Paths.get("/opt/homebrew/bin"),
      Paths.get("/usr/local/bin"),
      home.resolve(".volta").resolve("bin")
    ) ++ latestNvmBin(home)
    (fromPath ++ extras).distinct

  /** Child PATH = dir of the resolved npm first, so its `env node` shebang resolves. */
  def childPath(env: Map[String, String], npmCommand: String): String =
    val current = env.getOrElse("PATH", "")
    val head = Option(Paths.get(npmCommand).getParent).map(_.toString).toVector
    (head ++ splitPath(current)).distinct.mkString(File.pathSeparator)

  private def splitPath(raw: String): Vector[String] =
    raw.split(File.pathSeparatorChar).toVector.map(_.trim).filter(_.nonEmpty)

  private def latestNvmBin(home: Path): Vector[Path] =
    val versions = home.resolve(".nvm").resolve("versions").resolve("node")
    if !Files.isDirectory(versions) then Vector.empty
    else
      Try:
        val stream = Files.list(versions)
        try
          stream.iterator().asScala
            .filter(p => Files.isDirectory(p) && Files.isDirectory(p.resolve("bin")))
            .map(_.getFileName.toString)
            .toVector
            .sortWith(versionNewer)
            .take(1)
            .map(v => versions.resolve(v).resolve("bin"))
        finally stream.close()
      .getOrElse(Vector.empty)

  private def versionNewer(a: String, b: String): Boolean =
    val pa = a.stripPrefix("v").split('.').map(_.toIntOption.getOrElse(0))
    val pb = b.stripPrefix("v").split('.').map(_.toIntOption.getOrElse(0))
    pa.zipAll(pb, 0, 0).find(_ != _).exists((x, y) => x > y)
