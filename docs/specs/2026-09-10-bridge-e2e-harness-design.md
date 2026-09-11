# Bridge E2E 会话 Harness(EngineSessionHarness)设计

日期:2026-09-10
状态:待用户评审
关联代码:`apps/desktop/src/main/bridge/`(dshReopenE2e.integration.test.ts、engineDaemonE2e.integration.test.ts、e2e/)

## 背景与痛点

真引擎集成测试每写一个都要手搓一遍基础设施:

- `dshReopenE2e` 手搓了:freePort、fixture HOME/run/runtime、dshd wrapper 写入、until 轮询 + diagnose(超时 dump 事件/日志)、startPhase(BridgeClient + SessionController + 事件收集的组装)
- `engineDaemonE2e` 又手搓了一遍同名设施,且 `until` 签名不同(probe+predicate vs finder)——组装错误会重复发生

## 目标 / 非目标

**目标**:通用会话 harness(工具层)。`exited`/`bridgeError` 内建进等待失败信息;引擎来源三档;来源可见性。

**非目标**:不做声明式生命周期 DSL;不抽跨包共享 package;构建默认不进 harness(仅 stage 档显式 opt-in)。

## 结构

```
apps/desktop/src/main/bridge/e2e/
  engineE2eFixture.ts   增强:FAST_E2E_ENGINE 解析 + dir 覆盖 + stage preflight
  stubLlmServer.ts      不动
  sessionHarness.ts     新:EngineSessionHarness 类
  dshScenario.ts        新:dsh 专属场景件
dshReopenE2e.integration.test.ts   改造为首个消费者
engineDaemonE2e.integration.test.ts 迁移(第二消费者,验证 API 通用性)
```

## API 草案

```ts
class EngineSessionHarness {
  static async start(t, {command?, env?, timeoutMs?}): Promise<EngineSessionHarness>
  // 组装 BridgeClient + SessionController,开始收集 events/logs

  events(): EngineEvent[]            // 已收到的全部事件
  logs(): string[]                   // 引擎 stderr/stdout 行
  engineSource(): string             // provenance(见下节)

  async waitEvent<T>(type, predicate?, timeoutMs?): Promise<T>
  // 单一等待原语(取代两套 until):
  // 超时 → 抛出含 diagnose() 的错误:最近30条事件、日志尾50行、
  //        engine 进程 exited/exitCode、engineSource
  // 引擎提前退出(boot 阶段)→ 立即报 exited + exitCode,不傻等超时

  async close()
  // bridge close → engine proc kill(已退则跳过)→ dshd 由 dshScenario 管
}
```

`dshScenario.ts`(dsh 专属,不进通用 harness):

- `writeDshdWrapper(dshPort)` — bin/dshd wrapper 写入
- `killDaemon(dshPort)` — pgrep 按端口串清理(t.after 挂靠)
- `touchInstalled()` — `.installed` 标记
- env 组装:FAST_DSH_PORT、隔离端口(freePort)

端口策略:全部 OS 临时分配(bind :0 → close → 复用),隔离 HOME/run/runtime,与开发者本机运行的实例无冲突;boot 抢端口竞态由 phase A 保留 3 次重试兜底(重试语义留测试侧:close 掉本轮 harness,重新 start 一轮)。

## 引擎来源(FAST_E2E_ENGINE 三档)

| 档 | 行为 | provenance 打印 |
|---|---|---|
| 未设 / `placed`(默认) | `placedEngineCli` 现链路;引擎缺失 → skip(不 fail),CI 兼容 | 扫 `lib/agent-coding_3-*.jar` 版本 |
| `stage` | `agent/modules/cli/target/universal/stage/agent-cli/bin/fast-cli`;preflight 对比 `agent/modules/*/src` 最新 mtime vs stage jar mtime,过期才跑 `sbt cli/Universal/stage`(增量,热轮 30s~2min);`FAST_USE_SYSTEM_JAVA=1` | `agent@<git short sha> (stage, <time>)` |
| `<dir>` | 直接用该目录 `bin/fast-cli`(如 `agent/dist.sh` 产物、本地发布包重建的 current/) | 目录名 + mtime |

原理依据(已核实):agent/ 的 cli 模块启用 JavaAppPackaging,Universal mappings 即完整 dist 布局(bin/lib/conf/extensions/native),launcher 自带与 placed engine 相同的 -D 映射 → 测试侧零特殊化。不做纯 classpath 直跑(engine 期望 dist 文件布局:conf/、extensions/、ripgrep/treesitter dylib)。

agent/ 代码更新链路(文档化,不默认自动化):
- 路 A:`cd agent && sbt publishEngineM2`(版本同 0.4.5 可覆盖,~/.m2)→ `cd fast && ./scripts/fetch-engine.sh --clean`
- 路 B:`cd agent && ./dist.sh` → FAST_E2E_ENGINE=<dist 目录>
- 路 C(本设计的 stage 档):改完 agent/ 代码直接跑测试,preflight 增量重 stage

## 错误处理

- waitEvent 超时:diagnose 全量(事件/日志/exited/provenance)
- boot 阶段引擎退出:立即失败并带 exitCode,不混入超时
- dshd 清理:t.after 挂 killDaemon;崩溃残留的旧 daemon 只占随机旧端口,不与下轮冲突(freePort 每轮重新分配)

## 验收

1. dshReopenE2e 改造为 harness 消费者后,`pnpm run pretest` + integration 测试绿(真实 dshd、行为断言不变)
2. engineDaemonE2e 迁移后同样绿——证明 API 对"非 dsh"场景也通用
3. 超时场景(人为 stub 不回包)能看到 diagnose 完整输出与 provenance
4. FAST_E2E_ENGINE 三档行为符合上表;placed 缺失时 skip 而非 fail
