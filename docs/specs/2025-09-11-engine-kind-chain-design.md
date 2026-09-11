# engineKind 传递链路重构 — UI 承诺制

日期:2025-09-11
状态:已批准(交互式设计评审通过)
范围:agent(Scala 引擎)+ fast(TS 桌面/tui/mobile 客户端),协议向后兼容

## 背景与根因

症状:UI 引擎选择器显示 fast,实际运行 dsh,多次单点修补无效。

根因:"未显式指定引擎时用什么"存在 4 处互相矛盾的答案:

| 位置 | 兜底值 |
|---|---|
| 引擎注册表 defaultId(合并 overlay) | overlay 的 dsh |
| `EngineIds.read` 默认参数 / `OpenedSessions.idOf` 兜底 | Fast |
| 客户端 `?? 'fast'`(taskLifecycle / uiPublisher / parseEngineKind) | 'fast' |
| wire 协议 engine_kind 省略时的解读 | "fast" |

叠加两条绕行路径:桌面冷启动 `--continue` 恢复 DB 最新会话(带旧 kind);`/new` 斜杠命令服务端解析 `None → registry default`。

用户级 overlay(`~/Library/Application Support/@fast-ide/desktop/runtime/conf/engines.overlay.yaml`)可覆盖 default,而 UI 初始值硬编码 'fast' 从不读取设置——UI 与引擎各说各话。

## 核心设计:三条规则

- **R1 显式优先(UI 承诺制)**:每个用户 turn(`SubmitUserMessage`)携带当前 UI 选中的 engineKind。与会话粘性 kind 不同 → **隐式改绑**:复用 SetEngine 的 rebind + 落库 + 模型目录切换路径。粘性始终跟随最后实际使用的引擎。
- **R2 默认唯一**:无 UI 路径的兜底 = app 内置 yaml 的 `default`(fast)。解析阶梯:`turn 显式 > 会话粘性(DB) > 内置 default`。**overlay 的 `default:` 从阶梯中剔除**(enabled/config 合并照常)。
- **R3 不可用即拒**:turn 携带的 kind 不在 available 集合 → 拒绝该 turn + 错误事件,**绝不静默回退**。

## 协议改动(AgentAttachProtocol + TS bridge-protocol 同步)

- `SubmitUserMessage` 增加 `engineKind: Option[EngineId]`(optional,老客户端兼容)
- `CreateSession.engineKind` 保留(落初值;正确性不再依赖它)
- `SetEngine` 保留(服务 headless/CLI 程序化切换)
- `SetDefaultEngine` **废弃**:调用返回明确错误
- `sessions_list` 行继续回传 engine_kind(改绑后即时反映,供 UI hydrate)

## 引擎侧改动(agent 仓库)

1. `CommandLoop` SubmitUserMessage 分派:验可用性 → 与粘性不同则 rebind(与 setEngineKindCmd 提取公共 rebind 函数)→ 执行
2. 收敛硬编码:`EngineIds.read` 默认参数、`OpenedSessions.idOf` 兜底 → 统一读内置 yaml default
3. `EngineLoad.readResolved`:不再接受 overlay 覆盖 defaultId
4. `SetDefaultEngine` 处理器改为返回错误

## 客户端侧改动(fast 仓库)

1. bridge-protocol TS:`SubmitUserMessage` 增加 engineKind
2. `taskLifecycle`:sendMessage 路径携带 composer 当前 kind(不再只在 create 时带)
3. composer 初始值 = 会话行 kind ?? 'fast';选择器状态即"下一 turn 的引擎"
4. 合并两套 `setEngineKind`(sessionModelSettings + SessionController)→ 一份,只管 picker 状态;UI 常规路径不再发 SetEngine、去掉 stageEngineChange
5. tui / mobile 发送路径同步携带 kind

## 测试

- 引擎单测:阶梯解析、隐式改绑落库、不可用拒绝、overlay default 被忽略
- 桌面 e2e 重写 `engineKindE2e`:dsh 粘性会话 + UI 选 fast 发消息 → 实际跑 fast + DB 更新;`/new` 无 kind → fast;`--continue` 老会话显示与实际一致,切换后纠正

## 迁移

- 协议字段全 optional:老客户端不带 turn kind → 阶梯自然退化(粘性 > 内置 default),行为安全;engine 先行合入
- 本机 overlay 清理:删除 `default: dsh` 行,保留 `dsh: enabled: true`

## 决策记录

- 2025-09-11 用户拍板:默认以 app 内置为准,用户级覆盖的默认值不生效;每次对话带上 UI 当前选择引擎
- turn kind 与粘性不同 → 隐式改绑(非拒绝、非仅本 turn)
- 不可用 kind → 拒绝 turn,不静默回退
