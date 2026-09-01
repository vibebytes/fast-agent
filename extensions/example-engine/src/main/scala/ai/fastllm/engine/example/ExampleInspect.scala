package ai.fastllm.engine.example

import ai.fastllm.agent.engine.{EngineConfig, EngineId, EngineInspect, EngineProbe}

final class ExampleInspect extends EngineInspect:
  def id: EngineId = EngineId("example")
  def probe(config: EngineConfig): EngineProbe = EngineProbe.Empty
