package ai.fastllm.agent.dsh

import ai.fastllm.agent.dsh.proc.OfficialPort
import ai.fastllm.agent.engine.{EngineConfig, EngineId}

import java.nio.file.{Files, Path}

object DshRoots:
  def of(id: EngineId = EngineId("dsh")): Path =
    sys.props.get("fast.runtime.root").map(r => Path.of(r).resolve(s"engines/${id.value}"))
      .getOrElse(Path.of(sys.props.getOrElse("user.home", ".")).resolve(s".fast/engines/${id.value}"))

  def installed(root: Path = of()): Boolean =
    Files.isRegularFile(root.resolve("node_modules/@deepseek-ai/dsh/package.json"))
      || Files.isRegularFile(root.resolve(".installed"))

  def command(root: Path = of()): Option[String] =
    val bin = root.resolve("node_modules/.bin/dsh")
    val node = sys.env.get("FAST_NODE").orElse(sys.props.get("fast.node"))
    if Files.isRegularFile(bin) then Some(s"${bin.toAbsolutePath} web --host 127.0.0.1 --port $OfficialPort")
    else if node.isDefined && installed(root) then
      Some(s"${node.get} ${root.resolve("node_modules/@deepseek-ai/dsh")} web --host 127.0.0.1 --port $OfficialPort")
    else None

  def port(config: EngineConfig): Int =
    config("port").flatMap: j =>
      j.asNumber.flatMap(_.toInt).orElse(j.asString.flatMap(_.toIntOption))
    .orElse(sys.props.get("fast.dsh.port").orElse(sys.env.get("FAST_DSH_PORT")).flatMap(_.trim.toIntOption))
    .getOrElse(proc.OfficialPort)

  def rejectsNpx(command: String): Boolean =
    command.contains("npx --yes")
