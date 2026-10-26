package ai.fastllm.fast.vibe3d

import io.circe.Json

import java.nio.file.{Files, Path, Paths}
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

class Vibe3dConfigResolutionSpec extends AnyFunSuite with Matchers:

  private def tempTree(name: String, entries: List[String] = List.empty): Path =
    val root = Files.createTempDirectory(s"vibe3d-spec-$name")
    entries.foreach { rel =>
      val p = root.resolve(rel)
      Files.createDirectories(p.getParent)
      Files.writeString(p, "x")
    }
    root

  private def withRoot(key: String, value: String): Map[String, Json] = Map(key -> Json.fromString(value))

  test("rootOf: config.root beats VIBE3D_ROOT"):
    val got = Vibe3dConfig.rootOf(withRoot("root", "/cfg-root"), Map("VIBE3D_ROOT" -> "/env-root"), bundled = None)
    got shouldBe Paths.get("/cfg-root").toAbsolutePath.normalize

  test("rootOf: VIBE3D_ROOT beats bundled root"):
    val got = Vibe3dConfig.rootOf(
      Map.empty,
      Map("VIBE3D_ROOT" -> "/env-root"),
      cwd = Paths.get("/w"),
      bundled = Some(Paths.get("/bundled/vibe3d"))
    )
    got shouldBe Paths.get("/env-root").toAbsolutePath.normalize

  test("rootOf: existing bundled root beats cwd/vibe3d"):
    val bundled = tempTree("bundled-real").resolve("vibe3d")
    Files.createDirectories(bundled)
    val got = Vibe3dConfig.rootOf(Map.empty, Map.empty, cwd = Paths.get("/w"), bundled = Some(bundled))
    got shouldBe bundled.toAbsolutePath.normalize

  test("rootOf: missing bundled root falls through to cwd/vibe3d"):
    val got = Vibe3dConfig.rootOf(Map.empty, Map.empty, cwd = Paths.get("/w"), bundled = Some(Paths.get("/no-such-bundle/vibe3d")))
    got shouldBe Paths.get("/w/vibe3d").toAbsolutePath.normalize

  test("rootOf: no bundled root falls back to cwd/vibe3d"):
    val got = Vibe3dConfig.rootOf(Map.empty, Map.empty, cwd = Paths.get("/w"), bundled = None)
    got shouldBe Paths.get("/w/vibe3d").toAbsolutePath.normalize

  test("rootOf: bundled root wins only when it is a directory"):
    val bundled = tempTree("bundled")
    val cwd = tempTree("cwd")
    val got = Vibe3dConfig.rootOf(Map.empty, Map.empty, cwd = cwd, bundled = Some(bundled.resolve("vibe3d")))
    got shouldBe cwd.resolve("vibe3d").toAbsolutePath.normalize

  test("from: node resolution prefers config.node, then VIBE3D_NODE, then FAST_NODE, then default"):
    val root = tempTree("node-resolution", List("packages/daemon/dist/index.js", "packages/mcp/dist/index.js"))

    def nodeOf(cfg: Map[String, Json], env: Map[String, String]): String =
      Vibe3dConfig.from(cfg, env, cwd = Paths.get("/w"), bundled = Some(root)).toOption.get.node

    nodeOf(withRoot("node", "explicit-node"), Map("VIBE3D_NODE" -> "env-node", "FAST_NODE" -> "fast-node")) shouldBe "explicit-node"
    nodeOf(Map.empty, Map("VIBE3D_NODE" -> "env-node", "FAST_NODE" -> "fast-node")) shouldBe "env-node"
    nodeOf(Map.empty, Map("FAST_NODE" -> "fast-node")) shouldBe "fast-node"
    nodeOf(Map.empty, Map.empty) shouldBe "node"

  test("from: bundled root passes existence checks like any other root"):
    val bundled = tempTree("bundled", List("packages/daemon/dist/index.js", "packages/mcp/dist/index.js"))
    val got = Vibe3dConfig.from(Map.empty, Map.empty, cwd = Paths.get("/w"), bundled = Some(bundled))
    got.isRight shouldBe true

  test("from: missing build under bundled root reports the same activation error"):
    val bundled = tempTree("bundled-empty")
    val got = Vibe3dConfig.from(Map.empty, Map.empty, cwd = Paths.get("/w"), bundled = Some(bundled))
    got.swap.toOption.exists(_.contains("vibe3d build missing")) shouldBe true

  test("mcpCommand passes --autostart false; daemon is owned solely by Vibe3dRuntime"):
    val root = tempTree("mcp-command", List("packages/daemon/dist/index.js", "packages/mcp/dist/index.js"))
    val cfg = Vibe3dConfig.from(Map.empty, Map.empty, cwd = Paths.get("/w"), bundled = Some(root)).toOption.get
    val cmd = cfg.mcpCommand("http://127.0.0.1:1", "tok")
    val i = cmd.indexOf("--autostart")
    i should be >= 0
    cmd(i + 1) shouldBe "false"
