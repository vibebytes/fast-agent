package ai.fastllm.agent.dsh

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

class LiveDshSpec extends AnyFunSuite with Matchers:

  test("no process and no FAST_DSH_* cancels instead of spawning"):
    val prevPort = sys.props.remove("fast.dsh.port")
    try
      if sys.env.get("FAST_DSH_PORT").exists(_.trim.nonEmpty) ||
          sys.env.get("FAST_DSH_COMMAND").exists(_.trim.nonEmpty)
      then succeed
      else if LiveDsh.attachExisting.isDefined then succeed
      else
        val thrown = intercept[org.scalatest.exceptions.TestCanceledException](LiveDsh.open)
        thrown.getMessage should include("no live DSH")
    finally prevPort.foreach(v => sys.props.update("fast.dsh.port", v))
