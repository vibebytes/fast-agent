# MCP env 桥接边界归一化

日期：2026-09-18

## 目标与范围

用户已选择在桥接边界统一 env 格式，不扩展客户端或桌面 UI 的 env 类型。
仅修复 MCP 列表及写操作返回行的类型不一致；不改变控制操作、引擎存储或编辑器保存行为。

## 已确认的引擎编码

- `agent/modules/runtime/engine/src/main/scala/ai/fastllm/agent/mcp/McpServerRowCodec.scala` 将 env 对象编码为 JSON 字符串存储。
- `admin/AdminRows.scala` 对 env 脱敏后作为字符串输出。
- `runtime/mcp/McpAdmin.scala` 的 `toWire` 尝试解析对象或数组 JSON，解析失败时保留原字符串。
- 因此字符串应按 JSON 解析，不按换行 KEY=VALUE 格式猜测。

## 设计

在 `fast/apps/desktop/src/main/bridge/workspace/mcp.ts` 的共享结果转换函数中处理 env：

1. 已有对象、字符串数组以及缺省 env 保持原样。
2. 字符串使用 JSON.parse 解码一次；仅接受所有值均为字符串的对象或仅含字符串的数组。
3. 非法 JSON、null、标量或含非字符串成员的解码结果返回 `{ok: false, notice}`，错误提示包含服务器名称，但不包含 env 内容或解析器原始错误，避免泄露敏感值。
4. 不静默删除非法 env，不返回部分成功列表，不更改原始事件对象。
5. List、Put、Enabled、Import、Reload 五条返回路径共用该转换函数，成功结果使用 `McpServerRow[]`。
6. 写操作归一化失败的提示应说明响应无法读取，不能暗示引擎写入未发生；本次不增加自动重试。

保留协议对字符串的接收能力；客户端和桌面 DTO 继续只接收对象或字符串数组。

## 验收

- 为五条返回路径分别覆盖 JSON 对象字符串和 JSON 数组字符串的归一化。
- 覆盖对象、数组、缺省 env、空对象和空数组的保留。
- 覆盖非法 JSON、空字符串、null JSON、标量 JSON、非字符串对象值及数组元素的拒绝。
- 验证错误提示不包含输入的 env 值，并验证原始事件不被修改。
- MCP 定向测试通过；桌面主进程及 renderer 类型检查通过，或明确列出与本修复无关的剩余错误。
- git diff --check 通过；不提交或覆盖其他进行中的改动。

## 当前进度

用户已确认本文设计。撤回本轮未完成的返回类型调整，保留此前工作；共享归一化函数及新增测试尚未实现。后续按本文验收要求推进实现与验证。
