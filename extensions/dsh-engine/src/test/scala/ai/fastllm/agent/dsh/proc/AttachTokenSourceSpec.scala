package ai.fastllm.agent.dsh.proc

import ai.fastllm.agent.dsh.DshRoots
import ai.fastllm.agent.engine.EngineId
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.{Await, Future}
import scala.concurrent.duration.*

/** Attach must reuse the token the engine was launched with. That token is persisted
  * at `DshRoots.of()/.token` by `rememberToken` at spawn time, so it survives a JVM
  * restart. A fresh JVM attaching to an already-running dsh has no `fast.dsh.token`
  * prop, yet the launch token is on disk.
  */
class AttachTokenSourceSpec extends AnyFunSuite with Matchers:

  test("attach reads the persisted launch token when the JVM prop is absent"):
    val prevProp = sys.props.get("fast.dsh.token")
    val prevRoot = sys.props.get("fast.runtime.root")
    val prevHome = sys.props.get("user.home")
    val dir = java.nio.file.Files.createTempDirectory("dsh-attach-file-")
    sys.props.update("fast.runtime.root", dir.toString)
    sys.props.update("user.home", dir.toString)
    sys.props.remove("fast.dsh.token")
    try
      val root = DshRoots.at(EngineId("dsh"), Some(dir.toString), dir.toString)
      java.nio.file.Files.createDirectories(root)
      java.nio.file.Files.writeString(root.resolve(".token"), "launch-token-on-disk")
      await(DshProcess.attach(3080).token) shouldBe Some("launch-token-on-disk")
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
