package ai.fastllm.agent.dsh

import ai.fastllm.agent.channel.{Admit, AgentAttachProtocol, AgentLoop, Caps, ChannelMessageWindow, EventRow, RouteResult, dshQueuedOnto}
import ai.fastllm.agent.engine.{EngineId, EngineIds, EngineSwitch}
import ai.fastllm.agent.remote.Client
import io.circe.Json
import io.circe.parser.parse
import io.circe.syntax.*
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import scala.concurrent.ExecutionContext
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.{Await, Future, Promise}
import scala.concurrent.duration.*
import scala.io.Source

/** DshLoopSpec barrel — domains live in Dsh{Submit,Ask,Ingest,Catalog}Spec. */
class DshLoopSpec extends AnyFunSuite with Matchers with DshLoopKit
    with DshSubmitSpec with DshAskSpec with DshIngestSpec with DshCatalogSpec
