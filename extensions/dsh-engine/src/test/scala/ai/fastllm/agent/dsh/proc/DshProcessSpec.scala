package ai.fastllm.agent.dsh.proc

import ai.fastllm.agent.dsh.DshRoots
import ai.fastllm.agent.engine.EngineId
import io.circe.Json
import io.circe.syntax.*
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.{Await, Future}
import scala.concurrent.duration.*

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

  test("sources resolves the six-level priority matrix"):
    val dir = java.nio.file.Files.createTempDirectory("dsh-src-")
    val root1Dir = dir.resolve("r1")
    val root2Dir = dir.resolve("r2")
    val root1 = DshRoots.at(EngineId("dsh"), Some(root1Dir.toString), root2Dir.toString)
    val root2 = DshRoots.at(EngineId("dsh"), None, root2Dir.toString)
    java.nio.file.Files.createDirectories(root1)
    java.nio.file.Files.createDirectories(root2)
    java.nio.file.Files.writeString(root1.resolve(".token"), "from-root1")
    java.nio.file.Files.writeString(root2.resolve(".token"), "from-root2")
    val props = Map("fast.runtime.root" -> root1Dir.toString, "user.home" -> root2Dir.toString)
    val env = Map[String, String]()
    sources(None, props, env).token shouldBe Some("from-root1")
    sources(None, props, env ++ Map("FAST_DSH_TOKEN" -> "from-env")).token shouldBe Some("from-env")
    sources(None, props ++ Map("fast.dsh.token" -> "from-prop"), env ++ Map("FAST_DSH_TOKEN" -> "from-env"))
      .token shouldBe Some("from-prop")
    val tf = dir.resolve("tf.txt")
    java.nio.file.Files.writeString(tf, "from-tokenfile")
    val cfgTf = Json.obj("tokenFile" -> tf.toString.asJson).asObject.get.toMap
    sources(Some(cfgTf), props ++ Map("fast.dsh.token" -> "from-prop"), env ++ Map("FAST_DSH_TOKEN" -> "from-env"))
      .token shouldBe Some("from-tokenfile")
    val cfg = Json.obj("token" -> "from-config".asJson, "tokenFile" -> tf.toString.asJson).asObject.get.toMap
    sources(Some(cfg), props ++ Map("fast.dsh.token" -> "from-prop"), env ++ Map("FAST_DSH_TOKEN" -> "from-env"))
      .token shouldBe Some("from-config")

  test("sources normalizes URL tokens and skips empty values"):
    val dir = java.nio.file.Files.createTempDirectory("dsh-norm-")
    val root1Dir = dir.resolve("r1")
    val root1 = DshRoots.at(EngineId("dsh"), Some(root1Dir.toString), dir.toString)
    java.nio.file.Files.createDirectories(root1)
    val props = Map("fast.runtime.root" -> root1Dir.toString)
    val env = Map[String, String]()
    sources(None, props ++ Map("fast.dsh.token" -> "abc123"), env).token shouldBe Some("abc123")
    sources(None, props ++ Map("fast.dsh.token" -> "http://127.0.0.1:3080/?token=X&y=1"), env).token shouldBe Some("X")
    sources(None, props ++ Map("fast.dsh.token" -> "http://127.0.0.1:3080/#frag"), env).token shouldBe None
    java.nio.file.Files.writeString(root1.resolve(".token"), "from-root1")
    sources(None, props ++ Map("fast.dsh.token" -> ""), env).token shouldBe Some("from-root1")

  test("sources marks a missing tokenFile and continues the chain"):
    val dir = java.nio.file.Files.createTempDirectory("dsh-tf-")
    val root1Dir = dir.resolve("r1")
    val root1 = DshRoots.at(EngineId("dsh"), Some(root1Dir.toString), dir.toString)
    java.nio.file.Files.createDirectories(root1)
    java.nio.file.Files.writeString(root1.resolve(".token"), "from-root1")
    val props = Map("fast.runtime.root" -> root1Dir.toString)
    val env = Map[String, String]()
    val cfg = Json.obj("tokenFile" -> "/nonexistent-xyz/.token".asJson).asObject.get.toMap
    val ts = sources(Some(cfg), props, env)
    ts.token shouldBe Some("from-root1")
    ts.probed should contain("config.tokenFile=/nonexistent-xyz/.token(missing)")

  test("rememberToken migrates a root2 token to root1 and dedups when roots coincide"):
    val dir = java.nio.file.Files.createTempDirectory("dsh-mig-")
    val root1Dir = dir.resolve("r1")
    val root2Dir = dir.resolve("r2")
    val root1 = DshRoots.at(EngineId("dsh"), Some(root1Dir.toString), root2Dir.toString)
    val root2 = DshRoots.at(EngineId("dsh"), None, root2Dir.toString)
    java.nio.file.Files.createDirectories(root1)
    java.nio.file.Files.createDirectories(root2)
    java.nio.file.Files.writeString(root2.resolve(".token"), "from-root2")
    val props = Map("fast.runtime.root" -> root1Dir.toString, "user.home" -> root2Dir.toString)
    val env = Map[String, String]()
    val ts = sources(None, props, env)
    ts.token shouldBe Some("from-root2")
    ts.from shouldBe Some(s"${root2}/.token")
    val prevRoot = sys.props.get("fast.runtime.root")
    val prevProp = sys.props.get("fast.dsh.token")
    sys.props.update("fast.runtime.root", root1Dir.toString)
    sys.props.remove("fast.dsh.token")
    try
      rememberToken("from-root2")
      java.nio.file.Files.readString(root1.resolve(".token")).trim shouldBe "from-root2"
    finally
      prevRoot match
        case Some(v) => sys.props.update("fast.runtime.root", v)
        case None => sys.props.remove("fast.runtime.root")
      prevProp match
        case Some(v) => sys.props.update("fast.dsh.token", v)
        case None => sys.props.remove("fast.dsh.token")
    val same = Map("fast.runtime.root" -> root2Dir.resolve(".fast").toString, "user.home" -> root2Dir.toString)
    sources(None, same, env).probed.filter(l => l.endsWith("/.token")) shouldBe List(s"${root2}/.token")

  test("rememberToken writes the token file with 0600 permissions"):
    val prevRoot = sys.props.get("fast.runtime.root")
    val prevProp = sys.props.get("fast.dsh.token")
    val dir = java.nio.file.Files.createTempDirectory("dsh-0600-")
    sys.props.update("fast.runtime.root", dir.toString)
    sys.props.remove("fast.dsh.token")
    try
      rememberToken("secret-token")
      val f = DshRoots.of().resolve(".token")
      java.nio.file.Files.readString(f).trim shouldBe "secret-token"
      java.nio.file.attribute.PosixFilePermissions.toString(java.nio.file.Files.getPosixFilePermissions(f)) shouldBe "rw-------"
    finally
      prevRoot match
        case Some(v) => sys.props.update("fast.runtime.root", v)
        case None => sys.props.remove("fast.runtime.root")
      prevProp match
        case Some(v) => sys.props.update("fast.dsh.token", v)
        case None => sys.props.remove("fast.dsh.token")

  test("spawn pins an explicit token into the child env; a file-sourced token is not pinned"):
    val dir = java.nio.file.Files.createTempDirectory("dsh-pin-")
    val script = dir.resolve("dsh.sh")
    java.nio.file.Files.writeString(script, """#!/bin/sh
echo "dsh web: http://127.0.0.1:4312/?token=$FAST_DSH_TOKEN"
""")
    val argv = List("/bin/sh", script.toString)
    val p1 = DshProcess.spawn(argv, Some(Json.obj("token" -> "tok-explicit".asJson).asObject.get.toMap))
    await(p1.token) shouldBe Some("tok-explicit")
    val prevRoot = sys.props.get("fast.runtime.root")
    val prevProp = sys.props.get("fast.dsh.token")
    val prevHome = sys.props.get("user.home")
    sys.props.update("fast.runtime.root", dir.toString)
    sys.props.update("user.home", dir.toString)
    sys.props.remove("fast.dsh.token")
    try
      val root1 = DshRoots.at(EngineId("dsh"), Some(dir.toString), dir.toString)
      java.nio.file.Files.createDirectories(root1)
      java.nio.file.Files.writeString(root1.resolve(".token"), "from-file")
      if sys.env.get("FAST_DSH_TOKEN").forall(_.trim.isEmpty) then
        val p2 = DshProcess.spawn(argv)
        await(p2.token) shouldBe None
    finally
      prevRoot match
        case Some(v) => sys.props.update("fast.runtime.root", v)
        case None => sys.props.remove("fast.runtime.root")
      prevProp match
        case Some(v) => sys.props.update("fast.dsh.token", v)
        case None => sys.props.remove("fast.dsh.token")
      prevHome match
        case Some(v) => sys.props.update("user.home", v)
        case None => sys.props.remove("user.home")

  test("attach with no token source fails with all probed labels and no token value"):
    val prevProp = sys.props.get("fast.dsh.token")
    val prevRoot = sys.props.get("fast.runtime.root")
    val prevHome = sys.props.get("user.home")
    val dir = java.nio.file.Files.createTempDirectory("dsh-probe-")
    sys.props.remove("fast.dsh.token")
    sys.props.update("fast.runtime.root", dir.toString)
    sys.props.update("user.home", dir.toString)
    try
      if sys.env.get("FAST_DSH_TOKEN").forall(_.trim.isEmpty) then
        val cfg = Json.obj("tokenFile" -> "/nonexistent-xyz/.token".asJson).asObject.get.toMap
        val p = DshProcess.attach(1234, Some(cfg))
        val ex = intercept[Exception](await(p.token))
        ex.getMessage should include("dsh token missing (probed:")
        ex.getMessage should include("config.token")
        ex.getMessage should include("config.tokenFile=/nonexistent-xyz/.token(missing)")
        ex.getMessage should include("fast.dsh.token")
        ex.getMessage should include("FAST_DSH_TOKEN")
        ex.getMessage should include(".token")
        ex.getMessage should not include("secret")
    finally
      prevProp match
        case Some(v) => sys.props.update("fast.dsh.token", v)
        case None => sys.props.remove("fast.dsh.token")
      prevRoot match
        case Some(v) => sys.props.update("fast.runtime.root", v)
        case None => sys.props.remove("fast.runtime.root")
      prevHome match
        case Some(v) => sys.props.update("user.home", v)
        case None => sys.props.remove("user.home")

  private def await[A](f: Future[A]): A = Await.result(f, 4.seconds)
