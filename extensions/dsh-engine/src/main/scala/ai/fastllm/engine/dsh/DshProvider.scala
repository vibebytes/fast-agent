package ai.fastllm.engine.dsh

import ai.fastllm.agent.dsh.DshEngine
import ai.fastllm.agent.engine.{Engine, EngineConfig, EngineId, EngineProvider}

import scala.concurrent.ExecutionContext

/** SPI entry: YAML enabled → `DshEngine.fromHost` (official 3080 / env / config). */
final class DshProvider extends EngineProvider:
  def id: EngineId = EngineId("dsh")
  def apiVersion: String = EngineId.ApiVersion
  def create(config: EngineConfig): Engine =
    given ExecutionContext = ExecutionContext.global
    DshEngine(host => DshEngine.fromHost(host, config))
