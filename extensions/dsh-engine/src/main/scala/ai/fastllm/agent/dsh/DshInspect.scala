package ai.fastllm.agent.dsh

import ai.fastllm.agent.engine.{
  EngineConfig, EngineId, EngineInspect, EngineProbe, ProcessPhase, ProgramPhase
}

final class DshInspect extends EngineInspect:
  def id: EngineId = EngineId("dsh")
  def probe(config: EngineConfig): EngineProbe =
    val root = DshRoots.of()
    val program = if DshRoots.installed(root) then ProgramPhase.Installed else ProgramPhase.Missing
    val port = DshRoots.port(config)
    if DshProbe.ready("127.0.0.1", port) then
      EngineProbe(program, ProcessPhase.Running, Some(s"127.0.0.1:$port"))
    else
      EngineProbe(program, if program == ProgramPhase.Installed then ProcessPhase.Stopped else ProcessPhase.None)
