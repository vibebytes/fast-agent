package ai.fastllm.agent.dsh.proc

import ai.fastllm.agent.dsh.DshRoots
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

class DshProcessSpec extends AnyFunSuite with Matchers:

  test("banner line yields the advertised port"):
    portOf("dsh web: http://127.0.0.1:4312") shouldBe Some(4312)
    portOf("prefix dsh web: http://127.0.0.1:9 trailing") shouldBe Some(9)
    portOf("dsh web: http://localhost:4312") shouldBe None
    portOf("listening") shouldBe None

  test("banner line yields token from the launch URL"):
    tokenOf("dsh web: http://127.0.0.1:4312/?token=abc") shouldBe Some("abc")
    tokenOf("dsh web: http://127.0.0.1:4312") shouldBe None
    bannerOf("dsh web: http://127.0.0.1:9/?token=t1 extra") shouldBe Some((9, Some("t1")))

  test("remembered banner token is what attach reads"):
    val prevProp = sys.props.get("fast.dsh.token")
    val prevRoot = sys.props.get("fast.runtime.root")
    sys.props.update("fast.runtime.root", java.nio.file.Files.createTempDirectory("dsh-tok-").toString)
    sys.props.remove("fast.dsh.token")
    try
      rememberToken("from-banner")
      sys.props.remove("fast.dsh.token")
      launchToken shouldBe Some("from-banner")
      java.nio.file.Files.readString(DshRoots.of().resolve(".token")).trim shouldBe "from-banner"
    finally
      prevProp match
        case Some(v) => sys.props.update("fast.dsh.token", v)
        case None => sys.props.remove("fast.dsh.token")
      prevRoot match
        case Some(v) => sys.props.update("fast.runtime.root", v)
        case None => sys.props.remove("fast.runtime.root")

  test("default spawn command is empty and argvOf splits an explicit local command"):
    DefaultCommand shouldBe empty
    DefaultCommand should not include "npx"
    argvOf("/opt/dsh web --host 127.0.0.1 --port 3080") shouldBe
      List("/opt/dsh", "web", "--host", "127.0.0.1", "--port", "3080")

  test("argvOf keeps a quoted path with spaces as one program"):
    val bin =
      """/Users/kai/Library/Application Support/@fast-ide/desktop/runtime/engines/dsh/node_modules/.bin/dsh"""
    argvOf(s""""$bin" web --host 127.0.0.1 --port 3080""") shouldBe
      List(bin, "web", "--host", "127.0.0.1", "--port", "3080")

  test("local spawn argv keeps a bin path that contains spaces"):
    val runtime = java.nio.file.Files.createTempDirectory("Application Support")
    val root = runtime.resolve("engines/dsh")
    java.nio.file.Files.createDirectories(root.resolve("node_modules/.bin"))
    val bin = root.resolve("node_modules/.bin/dsh")
    java.nio.file.Files.writeString(bin, "#!/bin/sh\n")
    java.nio.file.Files.createDirectories(root.resolve("node_modules/@deepseek-ai/dsh"))
    java.nio.file.Files.writeString(root.resolve("node_modules/@deepseek-ai/dsh/package.json"), "{}")
    val argv = DshRoots.argv(root).get
    argv.head shouldBe bin.toAbsolutePath.toString
    argv.head should include("Application Support")
    argv.tail shouldBe List("web", "--host", "127.0.0.1", "--port", OfficialPort.toString)

  test("of attaches official 3080 when port and command are unset"):
    OfficialPort shouldBe 3080
    val prev = sys.props.get("fast.dsh.port")
    sys.props.remove("fast.dsh.port")
    try
      if sys.env.get("FAST_DSH_PORT").forall(_.trim.isEmpty) &&
          sys.env.get("FAST_DSH_COMMAND").forall(_.trim.isEmpty)
      then DshProcess.of shouldBe defined
    finally prev.foreach(v => sys.props.update("fast.dsh.port", v))
