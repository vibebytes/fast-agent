package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.{AgentEvent, EventRow}
import ai.fastllm.agent.channel.AgentAttachProtocol.Event.Passthrough
import ai.fastllm.agent.engine.EngineEventSink
import com.typesafe.scalalogging.LazyLogging
import io.circe.Json
import scala.concurrent.{Await, Future}
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.*
import scala.util.control.NonFatal

/** One DSH row: the client-visible wrapper around a payload. */
def dshRowJson(payload: Json): String = Json.obj("payload" -> payload).noSpaces

/**
 * The session river as seen by the DSH engine (docs/specs/2026-09-12-dsh-river-phase2-design.md §2).
 *
 * Batch-level on purpose: DSH hands over the payloads of one ingress frame at a time, core assigns the
 * seqs and owns the clock, and the engine never numbers a row of its own.
 */
trait DshRiver:
  /** River lane: persist `payloads`, answer the core-assigned seqs in input order. */
  def append(sessionId: String, runId: Option[String], payloads: List[Json]): List[Long]

  /** Live lane: publish without a seq, never persisted. */
  def live(sessionId: String, runId: Option[String], payloads: List[Json]): Unit = ()

  /** Rows with `seq > afterSeq`, oldest first — the tail's miss path and cold load. */
  def read(sessionId: String, afterSeq: Long): Future[List[EventRow]]

  /**
   * A caller cursor from another engine's clock: the river moves onto it so the rows are neither dropped
   * as already-applied nor replayed twice. Only an in-process river can do that — the shard store *is*
   * the clock, so the default is a no-op.
   */
  def adopt(sessionId: String, afterSeq: Long): Unit = ()

object DshRiver:
  /** Detached river: same numbering contract, process-local storage (tests, host-less runs). */
  def local(cap: Int = 2048): DshRiver = LocalRiver(cap)

  /** Shard-backed river: every seq comes from the Session entity. */
  def engine(sink: EngineEventSink, timeout: FiniteDuration = 10.seconds): DshRiver =
    EngineRiver(sink, timeout)

  private final class LocalRiver(cap: Int) extends DshRiver:
    private var nexts = Map.empty[String, Long]
    private var shifts = Map.empty[String, Long]
    private var tails = Map.empty[String, Vector[EventRow]]

    def append(sessionId: String, runId: Option[String], payloads: List[Json]): List[Long] =
      synchronized:
        val from = nexts.getOrElse(sessionId, 0L)
        val shift = shifts.getOrElse(sessionId, 0L)
        val seqs = payloads.indices.map(i => from + i + 1 + shift).toList
        val rows = payloads.zip(seqs).map((p, seq) => EventRow(seq, dshRowJson(p)))
        nexts = nexts.updated(sessionId, from + payloads.size)
        tails = tails.updated(sessionId, (tails.getOrElse(sessionId, Vector.empty) ++ rows).takeRight(cap))
        seqs

    override def adopt(sessionId: String, afterSeq: Long): Unit =
      synchronized:
        val rows = tails.getOrElse(sessionId, Vector.empty)
        if rows.nonEmpty then
          val shift = afterSeq + 1 - rows.head.seq
          shifts = shifts.updated(sessionId, shifts.getOrElse(sessionId, 0L) + shift)
          tails = tails.updated(sessionId, rows.map(r => r.copy(seq = r.seq + shift)))

    def read(sessionId: String, afterSeq: Long): Future[List[EventRow]] =
      Future.successful(synchronized(tails.getOrElse(sessionId, Vector.empty).filter(_.seq > afterSeq).toList))

  private final class EngineRiver(sink: EngineEventSink, timeout: FiniteDuration) extends DshRiver with LazyLogging:
    def append(sessionId: String, runId: Option[String], payloads: List[Json]): List[Long] =
      if payloads.isEmpty then Nil
      else
        val events = payloads.map(Passthrough(sessionId, _))
        attempt(sink.append(sessionId, runId, events)).orElse(attempt(sink.append(sessionId, runId, events))) match
          case Right(seqs) if seqs.size == payloads.size => seqs
          case Right(seqs)                               =>
            logger.error(s"dsh river append answered ${seqs.size} seqs for ${payloads.size} rows ($sessionId)")
            degraded(sessionId, "river_append_short")
            Nil
          case Left(e) =>
            logger.error(s"dsh river append failed for $sessionId", e)
            degraded(sessionId, s"river_append_failed: ${Option(e.getMessage).getOrElse(e.getClass.getSimpleName)}")
            Nil

    override def live(sessionId: String, runId: Option[String], payloads: List[Json]): Unit =
      if payloads.nonEmpty then sink.live(sessionId, runId, payloads.map(Passthrough(sessionId, _)))

    def read(sessionId: String, afterSeq: Long): Future[List[EventRow]] =
      sink.read(sessionId, afterSeq).recover:
        case NonFatal(e) =>
          logger.error(s"dsh river read failed for $sessionId", e)
          Nil

    private def attempt(rows: => Future[List[Long]]): Either[Throwable, List[Long]] =
      try Right(Await.result(rows, timeout))
      catch case NonFatal(e) => Left(e)

    /** River lane is down: the row is lost, the user is not — surface it on the live lane. */
    private def degraded(sessionId: String, detail: String): Unit =
      try sink.error(sessionId, detail)
      catch case NonFatal(_) => ()
