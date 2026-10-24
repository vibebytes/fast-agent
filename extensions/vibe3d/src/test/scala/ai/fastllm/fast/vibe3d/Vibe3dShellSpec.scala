package ai.fastllm.fast.vibe3d

import io.circe.Json
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}

private object ShellFixtures:
  def builtRoot(): Path =
    val root = Files.createTempDirectory("vibe3d-root")
    Files.createDirectories(root.resolve("packages/daemon/dist"))
    Files.createDirectories(root.resolve("packages/mcp/dist"))
    Files.writeString(root.resolve("packages/daemon/dist/index.js"), "")
    Files.writeString(root.resolve("packages/mcp/dist/index.js"), "")
    root

class Vibe3dConfigSpec extends AnyFunSuite with Matchers:
  import ShellFixtures.*

  test("defaults point at ./vibe3d and a dedicated home, and never steal focus"):
    Vibe3dConfig.rootOf(Map.empty, Map.empty, Path.of("/work")) shouldBe Path.of("/work/vibe3d")
    val root = builtRoot()
    Vibe3dConfig.from(Map("root" -> Json.fromString(root.toString)), Map.empty, Path.of("/work")).map(c =>
      (c.node, c.openEditor, c.blockedTools, c.home.endsWith(Path.of(".vibe3d", "fast")))
    ) shouldBe Right(("node", false, Nil, true))

  test("config overrides every knob and env fills the blanks"):
    val root = builtRoot()
    val cfg = Vibe3dConfig.from(
      Map(
        "root" -> Json.fromString(root.toString),
        "node" -> Json.fromString("/opt/node"),
        "openEditor" -> Json.True,
        "blockedTools" -> Json.arr(Json.fromString("open_editor"))
      ),
      Map("VIBE3D_HOME" -> "/tmp/vibe3d-home"),
      Path.of("/work")
    )
    cfg.map(c => (c.root, c.node, c.home, c.openEditor, c.blockedTools)) shouldBe
      Right((root, "/opt/node", Path.of("/tmp/vibe3d-home"), true, List("open_editor")))

  test("an unbuilt checkout fails before anything is spawned"):
    Vibe3dConfig.from(Map("root" -> Json.fromString("/nope/vibe3d")), Map.empty) shouldBe
      Left("vibe3d root not found: /nope/vibe3d")
    Vibe3dConfig.from(Map("root" -> Json.fromString(Files.createTempDirectory("empty").toString)), Map.empty).left.toOption
      .map(_.startsWith("vibe3d build missing: ")) shouldBe Some(true)

  test("a missing checkout is skipped, a broken one stays an error"):
    Vibe3dConfig.optional(Map("root" -> Json.fromString("/nope/vibe3d")), Map.empty) shouldBe None
    val empty = Files.createTempDirectory("empty")
    Vibe3dConfig.optional(Map("root" -> Json.fromString(empty.toString)), Map.empty)
      .map(_.left.toOption.exists(_.startsWith("vibe3d build missing: "))) shouldBe Some(true)
    val root = builtRoot()
    Vibe3dConfig.optional(Map("root" -> Json.fromString(root.toString)), Map.empty).flatMap(_.toOption).map(_.root) shouldBe Some(root)

  test("commands carry home, port-free daemon start and the discovered token"):
    val root = builtRoot()
    val cfg = Vibe3dConfig.from(Map("root" -> Json.fromString(root.toString), "home" -> Json.fromString("/tmp/h"))).toOption.get
    cfg.daemonCommand should contain allOf ("--home", "/tmp/h", "--open-editor", "false")
    cfg.mcpCommand("http://127.0.0.1:7001", "tok") should contain allOf ("--url", "http://127.0.0.1:7001", "--token", "tok")
    cfg.editorUrl(7001, "tok") shouldBe "http://127.0.0.1:7001/?t=tok"

class Vibe3dDiscoverySpec extends AnyFunSuite with Matchers:
  test("reads live run files and skips corrupt ones"):
    val home = Files.createTempDirectory("vibe3d-home")
    Files.createDirectories(home.resolve("run"))
    Files.writeString(home.resolve("run/11.json"), """{"pid":11,"host":"127.0.0.1","port":7100,"token":"a"}""")
    Files.writeString(home.resolve("run/12.json"), "not json", StandardCharsets.UTF_8)
    Vibe3dDiscovery.read(home) shouldBe List(Vibe3dDiscovery.Run(11, "127.0.0.1", 7100, "a"))
    Vibe3dDiscovery.byPid(home, 11).map(_.port) shouldBe Some(7100)
    Vibe3dDiscovery.byPid(home, 99) shouldBe None
    Vibe3dDiscovery.read(Files.createTempDirectory("no-run")) shouldBe Nil

class Vibe3dPlanSpec extends AnyFunSuite with Matchers:
  import ShellFixtures.*

  test("one stdio mcp, one pane, one open intent"):
    val root = builtRoot()
    val cfg = Vibe3dConfig.from(Map("root" -> Json.fromString(root.toString), "home" -> Json.fromString("/tmp/h"))).toOption.get
    val live = Vibe3dRuntime.Live(42, 7100, "tok")
    val plan = Vibe3dPlan.of(cfg, live, cfg.editorUrl(live.port, live.token))
    plan.mcp.name shouldBe "vibe3d"
    plan.mcp.command shouldBe List("node", root.resolve("packages/mcp/dist/index.js").toString, "--url", "http://127.0.0.1:7100", "--token", "tok", "--home", "/tmp/h")
    plan.mcp.env shouldBe Map("VIBE3D_HOME" -> "/tmp/h")
    plan.surface.url shouldBe Some("http://127.0.0.1:7100/?t=tok")
    plan.surface.fault shouldBe None
    plan.open.hcursor.get[String]("surfaceId").toOption shouldBe Some("vibe3d.editor")
    plan.open.hcursor.get[String]("url").toOption shouldBe Some("http://127.0.0.1:7100/?t=tok")

  test("the state intent names the surface and one of the host's four states"):
    val state = Vibe3dPlan.state("ready", "http://127.0.0.1:7100")
    state.hcursor.get[String]("surfaceId").toOption shouldBe Some("vibe3d.editor")
    state.hcursor.get[String]("state").toOption shouldBe Some("ready")
    state.hcursor.get[String]("detail").toOption shouldBe Some("http://127.0.0.1:7100")
    Vibe3dPlan.StateTopic shouldBe "ext.vibe3d.surface.state"
