package ai.fastllm.fast.vibe3d

import ai.fastllm.agent.ext.{McpServerSpec, McpTransport, SurfaceCapability, SurfaceDecl, SurfaceKind}
import io.circe.Json
import io.circe.syntax.*

/** The install payload: one MCP server, one panel, one open intent. Pure, so the wiring is testable
  * without a host context or a live daemon.
  */
final case class Vibe3dPlan(mcp: McpServerSpec, surface: SurfaceDecl, open: Json)

object Vibe3dPlan:
  val SurfaceId = "vibe3d.editor"
  val McpName = "vibe3d"
  val OpenTopic = "ext.vibe3d.surface.open"
  val StateTopic = "ext.vibe3d.surface.state"

  /** Lifecycle signal for the pane chip: `ready` once the daemon answers, `down` / `error` otherwise. */
  def state(value: String, detail: String): Json = Json.obj(
    "surfaceId" -> SurfaceId.asJson,
    "state" -> value.asJson,
    "detail" -> detail.asJson
  )

  def of(cfg: Vibe3dConfig, live: Vibe3dRuntime.Live, editorUrl: String): Vibe3dPlan =
    Vibe3dPlan(
      mcp = McpServerSpec(
        name = McpName,
        transport = McpTransport.Stdio,
        description = Some("Vibe3D 场景 / 资产 / 渲染"),
        command = cfg.mcpCommand(live.baseUrl, live.token),
        env = Map("VIBE3D_HOME" -> cfg.home.toString),
        blockedTools = cfg.blockedTools
      ),
      surface = SurfaceDecl(
        id = SurfaceId,
        kind = SurfaceKind.Web,
        title = "Vibe3D",
        url = Some(editorUrl),
        capabilities = Set(SurfaceCapability.ToolCall)
      ),
      open = Json.obj(
        "surfaceId" -> SurfaceId.asJson,
        "instanceKey" -> SurfaceId.asJson,
        "url" -> editorUrl.asJson,
        "title" -> "Vibe3D".asJson
      )
    )

  /** Open intent after a `room.create` notify: same shape as `of(...).open` plus the roomId, so
    * the host swaps the existing tab to that room's url and focuses it.
    */
  def openRoom(url: String, roomId: String): Json = Json.obj(
    "surfaceId" -> SurfaceId.asJson,
    "instanceKey" -> SurfaceId.asJson,
    "url" -> url.asJson,
    "title" -> "Vibe3D".asJson,
    "roomId" -> roomId.asJson
  )
