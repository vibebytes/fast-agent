package ai.fastllm.fast.vibe3d

import io.circe.parser.parse

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import scala.jdk.CollectionConverters.*
import scala.util.Try

/** The daemon binds an ephemeral port and publishes it as `<home>/run/<pid>.json`. Reading that
  * file is the only supported way to learn the port + token for the process we just spawned.
  */
object Vibe3dDiscovery:
  final case class Run(pid: Long, host: String, port: Int, token: String)

  def read(home: Path): List[Run] =
    val dir = home.resolve("run")
    if !Files.isDirectory(dir) then Nil
    else
      val stream = Files.list(dir)
      try
        stream
          .iterator()
          .asScala
          .filter(_.getFileName.toString.endsWith(".json"))
          .toList
          .flatMap(readOne)
      finally stream.close()

  def byPid(home: Path, pid: Long): Option[Run] = read(home).find(_.pid == pid)

  private def readOne(file: Path): Option[Run] =
    Try(Files.readString(file, StandardCharsets.UTF_8)).toOption.flatMap(parse(_).toOption).flatMap: json =>
      val c = json.hcursor
      for
        pid <- c.get[Long]("pid").toOption
        port <- c.get[Int]("port").toOption
        token <- c.get[String]("token").toOption
      yield Run(pid, c.get[String]("host").toOption.getOrElse("127.0.0.1"), port, token)
