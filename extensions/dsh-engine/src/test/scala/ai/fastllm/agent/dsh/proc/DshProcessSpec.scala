package ai.fastllm.agent.dsh.proc

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

class DshProcessSpec extends AnyFunSuite with Matchers:

  test("banner line yields the advertised port"):
    portOf("dsh web: http://127.0.0.1:4312") shouldBe Some(4312)
    portOf("prefix dsh web: http://127.0.0.1:9 trailing") shouldBe Some(9)
    portOf("dsh web: http://localhost:4312") shouldBe None
    portOf("listening") shouldBe None

  test("default spawn command is empty and argvOf splits an explicit local command"):
    DefaultCommand shouldBe empty
    DefaultCommand should not include "npx"
    argvOf("/opt/dsh web --host 127.0.0.1 --port 3080") shouldBe
      List("/opt/dsh", "web", "--host", "127.0.0.1", "--port", "3080")

  test("of attaches official 3080 when port and command are unset"):
    OfficialPort shouldBe 3080
    val prev = sys.props.get("fast.dsh.port")
    sys.props.remove("fast.dsh.port")
    try
      if sys.env.get("FAST_DSH_PORT").forall(_.trim.isEmpty) &&
          sys.env.get("FAST_DSH_COMMAND").forall(_.trim.isEmpty)
      then DshProcess.of shouldBe defined
    finally prev.foreach(v => sys.props.update("fast.dsh.port", v))
