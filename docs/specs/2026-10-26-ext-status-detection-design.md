# 扩展运行状态检测 — 通用能力设计（review 稿）

日期：2026-10-26
状态：待 review
关联：vibe3d daemon 连接问题、ExtLife 生命周期、`ext.status` 事件

## 1. 背景与问题

- 已有改进：ExtLife 停用即清理、重启拉起 + 幂等；ExtAdmin 提供 `extension status` 单点查询；设置页扩展列表已有状态点（第一版，反映 enabled / disabled / fault，即"启用状态"，不是"运行健康"）。
- 缺口：启用 ≠ 可用。以 vibe3d 为例，`enabled: true` 但 daemon 探测失败（端口占用、未构建、root 缺失）时，UI 仍显示"已启用"，用户在会话里调用才发现连不上。
- 现在的探测逻辑长在 vibe3d 扩展内部（`Vibe3dHealth.scala`），其他扩展（mcp、memory、code-index）无法复用，UI 也拿不到统一格式。

## 2. 目标 / 非目标

目标

1. **声明式**：扩展在 `extension.yaml` 声明"怎么探测"，不要求每个扩展写探测代码。
2. **通用**：引擎内置 HealthService 统一轮询、缓存、去抖；所有扩展同一条链路。
3. **可见**：设置 → 扩展管理逐项状态灯 + 详情（自检时间、失败原因）；可选悬浮/点击展开最近错误。
4. **增量推送**：状态变化时经 bridge 推 `ext.status` 事件，UI 不轮询。

非目标

- 不做自动重启策略（由 ExtLife 既有生命周期负责；HealthService 只报告，不拉起）。
- 不做扩展指标/遥测采集（超出状态灯范围）。
- 第一阶段不要求所有内置扩展都声明 status；未声明的回落到现有 enabled 展示。

## 3. 分层设计

### 3.1 manifest（extension.yaml，可选 `status:` 块）

```yaml
status:
  kind: http            # http | tcp | process
  discover:             # 可选：端口/地址来源
    file: "~/.vibe3d/fast/daemon.json"
    field: "port"
  url: "http://127.0.0.1:{port}/healthz"   # kind=http
  port: "{port}"                            # kind=tcp
  pidFile: "~/.vibe3d/fast/daemon.pid"      # kind=process（可选）
  timeoutMs: 1500
  intervalMs: 5000        # 失败退避到 intervalMs*6，上限 30s
  healthyIf: "2xx"        # http 专属，默认 2xx；可写 "200-299"
```

- `discover` 解决"端口是动态的"：从约定文件读字段，再模板替换。文件不存在 → 状态 `down`（detail: 未发现运行实例），不是 `disabled`。
- `{config.xxx}` 可引用 config 块（如 vibe3d 的 `root`、`home`），路径做 `~` 展开。

### 3.2 引擎侧（agent/modules/runtime/engine → ext 包）

- 新 `ExtStatusService`：
  - 输入：已启用且有 `status` 声明的扩展集合（ExtLoad/ExtAdmin 提供）。
  - 单线程调度器轮询探测；每次探测带超时；结果缓存为：

    ```scala
    final case class ExtHealth(
      id: String,
      state: ExtHealthState,   // ok | degraded | down | unknown
      detail: Option[String],  // 人类可读失败原因（最近一次）
      checkedAt: Long          // epoch ms
    )
    ```

  - **只在状态迁移时**发事件（ok→down、down→ok、detail 变化），避免刷屏。
  - 停用中的扩展不发探测（与 ExtLife 对齐），状态回落 `disabled` 由 UI 层渲染。

- 状态语义（写死，UI 不自定义）：

  | state | 含义 | 灯色 |
  |---|---|---|
  | ok | 探测通过 | 绿 |
  | degraded | 通了但慢/返回异常体（如 healthyIf 不满足） | 黄 |
  | down | 连不上 / discover 失败 / 超时 | 红 |
  | unknown | 声明了 status 但尚未完成首次探测 | 灰 |
  | （无 status 声明） | 旧行为：enabled/disabled 文案 | 灰点 |

### 3.3 协议与 bridge

- `fast/packages/core/bridge/protocol/src/protocol/plugins.ts`：
  - `PluginRow` 增加可选 `health?: { state: 'ok'|'degraded'|'down'|'unknown'; detail?: string; checkedAt?: number }`。
  - 新 host 事件 `ext.status.changed`，payload 为单个扩展的 ExtHealth；连接建立时先补发一次全量快照（`extensions list` 已含 health）。
- 侧面板状态点沿用；会话内调用扩展工具失败时，错误文案可引用最近 health.detail（后续增强，不在本期）。

### 3.4 UI（apps/desktop → settings）

- `PluginExtensions.tsx`：状态点渲染接入 `health`：
  - 有 health → 按上表着色，`title` = state + detail + checkedAt（相对时间）。
  - 无 health → 现状（enabled/disabled/fault）。
- 红灯项提供"查看详情"（只读面板，展示最近一次 detail 与探测时间），不做操作按钮（启停走既有开关）。
- i18n：zh-CN / en 增补 4 个 state 文案 + detail 模板。

## 4. vibe3d 落地映射

- `fast/extensions/vibe3d/extension.yaml` 增加：

  ```yaml
  status:
    kind: http
    discover: { file: "~/.vibe3d/fast/daemon.json", field: "port" }
    url: "http://127.0.0.1:{port}/healthz"
    timeoutMs: 1500
  ```

- 保留 `Vibe3dHealth.scala` 作为 managed 模式的内部保障（启动即探测、失败即报错给会话），但 UI 状态以 HealthService 为准；后续可把 Vibe3dHealth 收敛为 HealthService 的一个内嵌 probe，二选一（见 §6 待决）。
- daemon.json 写入方：daemon 启动成功后自写端口文件（vibe3d 仓库侧小改动），独立 MCP 启动与扩展托管启动共用同一份发现文件——这是"谁是启动者都不影响可见性"的关键。

## 5. 测试（含红测）

1. **声明解析红测**：status 块缺 url / discover 文件不存在 / 字段非端口 → 分别得 down + 明确 detail（不 crash、不误报 ok）。
2. **迁移去抖红测**：连续 3 次 down 才迁移（防瞬时抖动刷事件）；ok→down→ok 快速翻转只发首尾两条。
3. **停用清理红测**：已有（ExtAdminSpec）；补一条"停用后 HealthService 不再探测、UI 状态回落 disabled"。
4. **UI 红测**：useExtensions.test.ts 增补 health 渲染分支（绿/黄/红/灰四态 + detail title）。
5. **vibe3d e2e（手动档）**：daemon 被 kill 后 ≤10s 内 UI 变红；重启 daemon 后变绿。

## 6. 待决点（已定 2026-10-26）

1. **探测责任归属**：HealthService（引擎统一）为主；Vibe3dHealth 保留为启动自检，不收敛。
2. **状态粒度**：本期只做 ok / down 两态（外加 unknown 初始态）；degraded 不实现。
3. **轮询起点**：启用即探（间隔 5s，失败退避 ×6、上限 30s）。
4. **发现文件版本**：daemon run 文件（`<home>/run/<pid>.json`）补 `schema: 1` 字段，与 daemon 自身版本（`version`）区分，供 discover 演进。

## 7. 落地顺序

1. 协议字段 + 引擎 ExtStatusService + 红测（纯 Scala，无 UI）。
2. bridge 事件 + extensions list 补 health。
3. UI 状态灯接入 + i18n + 红测。
4. vibe3d：daemon.json 写入 + extension.yaml status 声明。

每步可独立合入；1–2 完成后 UI 不接也不影响现状。
