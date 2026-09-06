package ai.fastllm.agent.dsh

import ai.fastllm.agent.dsh.proc.OfficialPort
import ai.fastllm.agent.engine.{EngineConfig, EngineId}

import java.nio.file.{Files, Path}

object DshRoots:
  def of(id: EngineId = EngineId("dsh")): Path =
    at(id, sys.props.get("fast.runtime.root").orElse(sys.env.get("FAST_RUNTIME_ROOT")))

  /** Same resolution as `EngineAdmin.defaultUserRoot`: prop, then `FAST_RUNTIME_ROOT`, then `~/.fast`. */
  def at(id: EngineId, runtime: Option[String], home: String = sys.props.getOrElse("user.home", ".")): Path =
    runtime
      .map(r => Path.of(r).resolve(s"engines/${id.value}"))
      .getOrElse(Path.of(home).resolve(s".fast/engines/${id.value}"))

  def installed(root: Path = of()): Boolean =
    Files.isRegularFile(root.resolve("node_modules/@deepseek-ai/dsh/package.json"))
      || Files.isRegularFile(root.resolve(".installed"))

  def argv(root: Path = of()): Option[List[String]] =
    val bin = root.resolve("node_modules/.bin/dsh")
    val node = sys.env.get("FAST_NODE").orElse(sys.props.get("fast.node"))
    val flags = List("web", "--host", "127.0.0.1", "--port", OfficialPort.toString)
    if Files.isRegularFile(bin) then Some(bin.toAbsolutePath.toString :: flags)
    else if node.isDefined && installed(root) then
      Some(node.get :: root.resolve("node_modules/@deepseek-ai/dsh").toString :: flags)
    else None

  def command(root: Path = of()): Option[String] =
    argv(root).map: a =>
      a.map: tok =>
        if tok.exists(_.isWhitespace) then s"\"$tok\"" else tok
      .mkString(" ")

  def port(config: EngineConfig): Int =
    config("port").flatMap: j =>
      j.asNumber.flatMap(_.toInt).orElse(j.asString.flatMap(_.toIntOption))
    .orElse(sys.props.get("fast.dsh.port").orElse(sys.env.get("FAST_DSH_PORT")).flatMap(_.trim.toIntOption))
    .getOrElse(proc.OfficialPort)

  def rejectsNpx(command: String): Boolean =
    command.contains("npx --yes")
