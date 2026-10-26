# 通用「创建产物」卡片契约（Artifact Card）

状态：已实现 · 2026-10-26

## 1. 问题

工具创建了“可以打开的东西”（3D 房间、文档、报表、生成的站点…），但对话流里没有任何可见反馈，
用户只能靠助手文字里的 URL 或“已打开”的口头承诺判断，点击也不能打开右侧窗口。

需要一张**专门的创建卡片**，且不能为每一种工具写一套卡片：卡片属于宿主，数据属于工具。

## 2. 契约

工具在 MCP 返回的 `content` 里追加一个纯文本块（第二个 text block，不影响原有内容）：

```
<fast-artifact>{"kind":"scene","title":"…","subtitle":"…","meta":["…"],"open":{…}}</fast-artifact>
```

也接受围栏写法：

````
```fast-artifact
{…}
```
````

宿主解析后渲染**一张通用卡片**；解析失败不报错，退化为普通文本（卡片是增强，不是依赖）。

### 2.1 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 卡片标题，缺失则整卡不渲染 |
| `kind` | 否 | `scene` / `document` / `site` / `report` / `dataset` / `other`，只影响图标与配色 |
| `subtitle` | 否 | 一行说明 |
| `meta` | 否 | 最多 4 个 chip，每个 ≤ 32 字符，超出截断 |
| `open` | 否 | 打开动作，见 2.2；有 `open` 才出现「打开」按钮 |

### 2.2 `open` 的三种形态（封闭枚举）

```ts
{kind: 'app',     server: string, resourceUri: `ui://…`, title?: string}
{kind: 'file',    path: string}                 // 工作区相对路径
{kind: 'surface', extId: string, surfaceId: string, url: string,
                  instanceKey?: string, roomId?: string, title?: string}
```

- `app` → 打开 MCP App tab（`requestOpenMcpApp`）
- `file` → 走 `OpenFileContext`（工作区文件预览）
- `surface` → 走扩展 Web surface（`requestOpenSurface` → 右栏 tab）

校验：`file` 拒绝绝对路径与 `..`；`surface` 只接受 `http/https`，`extId`/`surfaceId` 需匹配
`^[A-Za-z0-9._-]{1,64}$`；`app` 的 `resourceUri` 必须是 `ui://`；未知 `kind` 降级 `other`；
`open` 声明了但非法 → **整卡返回 null**（宁可不出卡，也不出一个点了没反应的按钮）。

## 3. 渲染与点击

- 渲染层（`ArtifactCard.tsx`）不认识任何扩展名，只认识 `open.kind`；
  卡片整体可点击（`role=button`，支持 Enter/Space），右上角保留「打开」按钮，点击不冒泡。
- `surface` 点击是**显式用户意图**：先清掉该 key 的 closed 记录，再 `applySurfaceOpen`；
  rail 折叠时由 `App.tsx` 展开右栏（`onSurfaceOpenRequest`）。
- tab 监听者未挂载时点击请求进 backlog（同 `extId+surfaceId` 去重，上限 8 条），挂载后 drain，
  因此“先点卡片、后开右栏”的顺序也是安全的。

## 4. 新增一个“创建页”需要做什么

只有两步，都在生产者一侧：

1. 在工具返回里追加 `artifactBlock(...)`，填 `title` + `open`；
2. 若 `open.kind === 'surface'`，确认扩展已经能把该 `surfaceId` 的 URL 交给宿主（已有 `uiPublisher` 通道）。

宿主侧零改动；不新增工具名分支、不新增扩展白名单、不新增事件映射。
`app.asar` 里不应出现任何扩展名——这是架构红线（见 vibe3d 设计文档 §6.2 / §7.2.6）。

## 5. 已知取舍

- 块放在 `content` 文本里，模型也会看到这段 JSON（约 200 字符）。放在 `structuredContent`/`_meta`
  更干净，但那条通道目前只服务 MCP App，通用化需要改引擎侧事件，暂不做。
- 一次工具输出只取**第一个**块（`readArtifact`）：一个工具调用表达一件事，要出多张卡请拆成多次调用。
