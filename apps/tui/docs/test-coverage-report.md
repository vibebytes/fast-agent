# cli-ink 测试体系 Review 与覆盖报告

日期：2026-07-02 · 全量测试：**328 通过 / 0 失败**（`npm test`，约 2 分钟）

---

## 一、本轮 Review 发现的问题

### 1.1 虚假 / 失真的测试（已全部修正）

| 问题 | 危害 | 处理 |
|---|---|---|
| `keybindings.test.ts` 中名为 "detects history up" 的测试实际断言 `MOVE_UP` | 名不副实，掩盖了「↑ 键历史导航完全失效」这个真实 BUG（见 1.2） | 重写为键位契约测试：明确 ↑/↓ 解析为 MOVE_UP/MOVE_DOWN、由消费方决定语义，并新增「任意按键不得命中两个命令」的无歧义性测试 |
| `test-utils/AppRig.tsx` 的 `renderMainContentSnapshot` 返回常量 `{hasWelcome: true, itemCount: turns.length}` | 假 helper，看似能做集成断言实则什么都不验证（幸好无测试引用） | 删除整个文件 |
| `TextBuffer` 单测全绿，但 `Composer` 中的 TextBuffer 根本没有接线（`dispatch` 未解构、`multiline` 恒为 false） | 「被测模块」在真实 UI 中不生效——测试绿≠功能存在 | 移除 Composer 中的死代码；TextBuffer 单测保留（模块本身正确，未来接多行输入可用）；已在报告中标注「多行输入未实现」 |
| `Composer.test.tsx` 仅断言 4 种 prompt 前缀字符串 | 输入框的所有交互行为（打字/提交/历史/建议/清空）零覆盖 | 新增 7 个真实键盘交互测试（见 §三） |
| `ShortcutsDialog` 展示 Ctrl+R / Ctrl+S / Ctrl+F 等无处理器的"幽灵快捷键" | 对用户撒谎的 UI，且无测试能发现 | 修复 UI + 键位契约测试兜底 |

### 1.2 测试审查暴露的真实功能 BUG（已全部修复）

1. **输入历史 ↑/↓ 导航完全失效**（严重）
   `matchKeybinding` 首个命中即返回：↑ 永远解析为 `MOVE_UP`，而 `Composer` 监听的是永不可达的 `HISTORY_UP`。修复：Composer 直接消费 `MOVE_UP/MOVE_DOWN`（建议列表可见时优先移动建议焦点）。由 `ptyInputHistory.test.ts` 在真实终端里回归。

2. **Esc 语义三处失约**
   快捷键帮助写着 "Ctrl+U / Esc 清空输入"、运行时提示 "Esc 取消"，但 Esc 实际无任何处理（`CLEAR_INPUT` 的 Esc 分支被 `ESCAPE` 遮蔽）。修复为分层语义：
   - Composer：Esc 先收起建议列表 → 再清空已输入文本；
   - AppContainer：运行中且无审批/提问对话框时，Esc 取消当前任务；
   - 审批对话框维持原有 Esc=拒绝。
   由 `ptyEscCancel.test.ts`（含「审批期间 Esc 只拒绝不取消 run」的反向用例）回归。

3. **Ctrl+F 无处理器**：现接入 footer 配置对话框；Ctrl+R（反向搜索）/ Ctrl+S（排队）未实现，已从快捷键帮助中移除（运行中直接回车本来就会排队）。

4. **`run_failed` 的错误原因对用户不可见**：错误只进 footer 的 `errors:N` 计数器。修复：reducer 将失败原因以系统消息落入转录（`运行失败: <error>`）。由 `ptyClarify.test.ts` 的失败场景回归。

5. **`<Static>` 幽灵宽度导致沉降卡片边框撕裂**（严重，正是上一轮「卡片错位」的又一个根因）
   Ink 的 `<Static>` 盒子是 `position:absolute`——不继承终端宽度，而是被同一次 flush 中最宽的子项撑开（未换行的 CJK 长段落轻易量出 >终端宽度）。于是所有带边框的卡片被拉伸到幽灵宽度（120 列终端里画出 129 列的卡片），在终端边缘折行 → 滚回历史里就是断裂的边框。
   **该 BUG 由真实 LLM 录制的多行命令 fixture 回放测试当场抓出**。修复：`MainContent` 给每个 Static 条目钉上 `width={columns}`。由 `e2eMultilineShell.test.ts` 逐行断言「卡片每一行左右边框完整」回归。

### 1.3 测试基建评估（结论：架构真实可信）

- **PTY 层**（`node-pty` + `@xterm/headless`）：真实伪终端 + 真实 xterm 解析器渲染屏幕缓冲，键入的是真实字节序列（`\u001B[A`、`\r`、`\u0003`），验证的是用户真正看到的字符网格——这是本轮能抓住 Static 宽度 BUG 的关键。
- **mock-engine**：以 NDJSON 精确模拟 bridge 协议（含事件时序、审批/提问挂起状态机），协议形状由 `protocol.test.ts` 的 zod schema 测试锚定，双方不会静默漂移。
- **replay-engine**：回放真实引擎+真实 LLM 录制的 `recorded-*.jsonl`（14 个 fixture，含本轮新录的多行命令），支持 `FAST_E2E_RECORD_EVENTS` 一键重录。确定性回放 + 真实事件形状，是性价比最高的一层。
- 弱点：PTY 测试等待多依赖字符串匹配 + `e2e:normal:idle` footer 标记，个别用例用固定 `sleep` 规避 Ink 渲染竞态（已尽量收敛到 200–300ms）。

---

## 二、测试体系分层（现状）

```
L1 纯逻辑单测（~200 用例，毫秒级）
   reducer / turnAdapter / groupByTurn / toolMapping / textWidth / safeSplit
   / DeltaBatcher / protocol(zod) / router / commandSpec / suggestions / …
L2 组件渲染 + 键盘交互（ink-testing-library，~80 用例）
   inkSnapshots / inkStress / Composer 交互 / ApprovalDialog 交互
   / QuestionDialog 交互 / ThinkingBlock / Markdown / …
L3 PTY 全链路（真实终端字节流，mock-engine，17 个文件）
   冒烟 / 审批(y/n/生命周期/延迟) / 取消(Ctrl+C/Esc) / 历史导航 / clarify
   / run_failed / 斜杠命令 / command_result / 全屏 / 幽灵帧 / 静态漂移 / 无色
L4 e2e 回放（真实 LLM 录制 fixture，12 个文件）
   工具成败 / 审批通过·拒绝·恢复 / 队列 / 会话恢复 / thinking 展示
   / 取消恢复 / 多行命令卡片(新) — FAST_E2E_RECORD_EVENTS=<path> 可重录
```

## 三、本轮新增测试清单

| 层 | 文件 | 验证内容 |
|---|---|---|
| L1 | `keybindings.test.ts`（重写） | 键位契约：↑/↓/Esc/Tab/Ctrl+U/R/Enter 的唯一解析 + 无歧义性 |
| L2 | `Composer.test.tsx` +7 | 打字+回车提交并清空；↑/↓ 历史导航含草稿恢复；`/` 建议 + Tab 接受；Ctrl+U 清空；Esc 清空；Esc 先收起建议；空输入 Ctrl+U 清队列 |
| L2 | `QuestionDialog.test.tsx` +3 | 推荐项默认选中+回车；↑↓ 移动后回车；数字快捷选择 |
| L2 | `ApprovalDialog.test.tsx` +3 | y/n/a 即时决策；↑↓+回车映射 once/always/deny；Esc=拒绝 |
| L3 | `ptyInputHistory.test.ts` | ↑ 召回上一条消息 → Esc 清空 → 再召回并提交成功 |
| L3 | `ptyEscCancel.test.ts` ×2 | 流式中 Esc 取消回 idle 且最终答案不再出现；审批中 Esc 只拒绝 |
| L3 | `ptyClarify.test.ts` ×2 | clarify 提问 → "答:" 模式 → 回答往返 → 完成；run_failed 错误上屏且不锁死后续对话 |
| L4 | `e2eMultilineShell.test.ts` | 多行脚本卡片：每行内容左右边框完整（真实 LLM 录制回放） |

mock-engine 新增 `需要澄清`（clarify 状态机）与 `必然失败`（run_failed）两个场景。

## 四、覆盖率（L1+L2 层，`--experimental-test-coverage`）

**总体：行 84.0% · 分支 82.9% · 函数 88.8%**（PTY/e2e 层在子进程中运行，其对 `AppContainer`/`AgentProcess`/`main.tsx` 的覆盖不计入此数字）

高覆盖核心：`reducer.ts` 93% / `turnAdapter.ts` 87% / `toolMapping.ts` 96% / `protocol.ts` 99% / `DeltaBatcher` 100% / `ShellToolMessage` 89%。

低覆盖及理由：
- 仅 PTY 层覆盖：`AppContainer`（提交路由/对话框/键盘全局处理）、`AgentProcess`（子进程管理）——单测不可注入，由 17 个 PTY 文件兜底；
- 死代码或降级路径：`DenseToolMessage` 5%（`RawToolMessage` 4%）——极少触发的 renderer 分支，**建议后续补快照或评估删除**；
- `MarkdownTable` 26% / `syntaxHighlight` 4% / `OverflowContext` 21%：展示增强路径，风险低。

## 五、遗留建议（按优先级）

1. `DenseToolMessage` / `RawToolMessage` 补渲染测试或确认删除（疑似死分支）。
2. 反向搜索（Ctrl+R）从未实现——`InputContext.reverseSearchActive` 恒为 false，建议实现或删掉相关代码。
3. 多行输入（Shift+Enter/`NEWLINE`）未实现，TextBuffer 已具备能力，可评估接线。
4. PTY 用例中残余的固定 `sleep(200–300ms)` 可改为等待渲染标记，进一步降低偶发性。
5. 覆盖率可加入 CI（`tsx --test --experimental-test-coverage`），以 80% 行覆盖为闸门。
