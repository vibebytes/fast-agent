package ai.fastllm.engine.dsh

import ai.fastllm.agent.engine.{EngineConfig, EngineId}
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

class DshProviderSpec extends AnyFunSuite with Matchers:
  test("SPI provider id is dsh"):
    val p = DshProvider()
    p.id shouldBe EngineId("dsh")
    p.apiVersion shouldBe EngineId.ApiVersion
    p.create(EngineConfig()).id shouldBe EngineId("dsh")
