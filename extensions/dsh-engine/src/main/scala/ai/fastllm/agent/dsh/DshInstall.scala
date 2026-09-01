package ai.fastllm.agent.dsh

import ai.fastllm.agent.engine.{EngineId, EngineInstall, EngineLog}

import java.io.{BufferedReader, InputStreamReader}
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}
import java.util.concurrent.TimeUnit
import scala.util.control.NonFatal

final class DshInstall extends EngineInstall:
  def id: EngineId = EngineId("dsh")
  def run(root: Path, emit: EngineLog => Unit, cancelled: () => Boolean): Either[String, Unit] =
    val raw = root.toString
    if raw.startsWith("http") then Left("remote")
    else
      Files.createDirectories(root)
      val env = sys.env.toMap
      val home = Paths.get(sys.props.getOrElse("user.home", "."))
      val npm = NpmLocator.resolve(env, home, p => Files.exists(p)).getOrElse("npm")
      emit(EngineLog("install", s"npm: $npm", 0))
      val pb = ProcessBuilder(npm, "install", "@deepseek-ai/dsh")
      pb.directory(root.toFile)
      pb.environment().put("PATH", NpmLocator.childPath(env, npm))
      val proc = pb.start()
      val drain = (stream: String, in: java.io.InputStream) =>
        val reader = BufferedReader(InputStreamReader(in, StandardCharsets.UTF_8))
        try
          var line = reader.readLine()
          var seq = 0L
          while line != null do
            seq += 1
            emit(EngineLog(stream, line, seq))
            line = reader.readLine()
        catch
          case NonFatal(e) =>
            System.err.println(s"dsh install drain $stream: ${e.getMessage}")
        finally reader.close()
      val out = Thread(() => drain("stdout", proc.getInputStream), "dsh-install-out")
      val err = Thread(() => drain("stderr", proc.getErrorStream), "dsh-install-err")
      out.setDaemon(true)
      err.setDaemon(true)
      out.start()
      err.start()
      while proc.isAlive do
        if cancelled() then
          proc.destroy()
          if !proc.waitFor(5, TimeUnit.SECONDS) then proc.destroyForcibly()
          out.join(500)
          err.join(500)
          return Left("cancelled")
        Thread.sleep(50)
      out.join(500)
      err.join(500)
      if cancelled() then Left("cancelled")
      else if proc.exitValue() == 0 then
        Files.writeString(root.resolve(".installed"), "ok")
        Right(())
      else Left(s"npm exit ${proc.exitValue()}")
