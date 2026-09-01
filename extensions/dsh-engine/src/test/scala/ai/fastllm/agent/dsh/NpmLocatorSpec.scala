package ai.fastllm.agent.dsh

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.nio.file.{Files, Path, Paths}

class NpmLocatorSpec extends AnyFunSuite with Matchers:

  private val home = Paths.get("/home/u")
  private val missing: Path => Boolean = _ => false

  test("override env wins when non-blank"):
    NpmLocator.overrideCommand(Map("FAST_NPM_COMMAND" -> " /opt/node/bin/npm ")) shouldBe
      Some("/opt/node/bin/npm")
    NpmLocator.overrideCommand(Map("FAST_NPM_COMMAND" -> "   ")) shouldBe None

  test("searches PATH entries before well-known dirs"):
    val env = Map("PATH" -> s"/tools/bin:/usr/bin")
    val dirs = NpmLocator.candidateDirs(env, home)
    dirs.take(2) shouldBe Vector(Paths.get("/tools/bin"), Paths.get("/usr/bin"))
    dirs should contain(Paths.get("/opt/homebrew/bin"))
    dirs should contain(home.resolve(".volta").resolve("bin"))

  test("resolves npm from a well-known dir when absent from PATH"):
    val env = Map("PATH" -> "/usr/bin:/bin")
    val volta = home.resolve(".volta/bin/npm")
    val found = NpmLocator.resolve(env, home, p => p == volta)
    found shouldBe Some(volta.toString)

  test("returns None when nothing exists"):
    NpmLocator.resolve(Map.empty, home, missing) shouldBe None

  test("childPath prepends npm dir so its node shebang resolves"):
    val out = NpmLocator.childPath(Map("PATH" -> "/usr/bin:/bin"), "/opt/homebrew/bin/npm")
    out shouldBe s"/opt/homebrew/bin:/usr/bin:/bin"

  test("childPath tolerates bare command and empty PATH"):
    NpmLocator.childPath(Map.empty, "npm") shouldBe ""
    NpmLocator.childPath(Map("PATH" -> "/usr/bin"), "npm") shouldBe "/usr/bin"

  test("latestNvmBin picks highest version via resolve on real temp tree"):
    val root = Files.createTempDirectory("nvm-test")
    val versions = root.resolve(".nvm/versions/node")
    Files.createDirectories(versions.resolve("v8.17.0/bin"))
    Files.createDirectories(versions.resolve("v20.6.0/bin"))
    Files.createDirectories(versions.resolve("v22.19.0/bin"))
    Files.createDirectories(versions.resolve("v9.9.9/not-bin"))
    val dirs = NpmLocator.candidateDirs(Map.empty, root)
    dirs.last shouldBe versions.resolve("v22.19.0").resolve("bin")
