<div align="center">
  <img src="docs/hero.png?v=5" alt="Fast Agent — 企业级自学习 AI Agent，coding 是一等公民" width="100%">
</div>

<p align="center">
  <strong>企业级自学习 AI Agent，coding 是一等公民。</strong>
</p>

<p align="center">
  <a href="#下载与安装"><img alt="用户指南" src="https://img.shields.io/badge/📙_用户指南-v0.0.1_·_中文-ea580c?style=for-the-badge"></a>
</p>

<p align="center">
  <img alt="Release" src="https://img.shields.io/badge/release-v0.0.1-blue">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-brightgreen"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows%20%7C%20Android%20%7C%20iOS-informational">
  <img alt="Node" src="https://img.shields.io/badge/node-20.19%2B%20%7C%2022-339933">
  <a href="https://discord.gg/HXeK9QV57"><img alt="Discord" src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white"></a>
</p>

<p align="center"><a href="README.md">English</a> | <a href="README.zh-CN.md">中文</a></p>

<p align="center">
  <a href="#直接下载">下载</a> ·
  <a href="#通过源码安装">源码安装</a> ·
  <a href="#开发">开发</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#截图">截图</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="#社区">社区</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="#许可证">许可证</a>
</p>

Fast Agent 的目标是成为企业级、自学习的 AI Agent，并把 coding 作为一等公民。

- **企业级** – 提供可审查、可管理、可观测的能力，覆盖代码审查、回滚与追踪。
- **自学习** – 持续从项目经验中学习，下一任务优于上一任务。
- **Coding 优先** – 直接改代码、跑代码、落地代码，而不只是谈论代码。
- **集群与远程** – 支持多智能体协作与远程任务编排，分布式执行。
- **Agent 原生** – 所有组件都是 Agent，自主协作、高度可组合。

> [!IMPORTANT]
> Fast Agent **仍在开发中**（v0.0.1）。本机引擎可以改你的工作区并执行 shell。请审阅每一条审批，预期会有破坏性变更，不要把未签名安装包当作生产发行。软件按 [Apache 2.0](LICENSE) 按现状提供。

## 下载与安装

v0.0.1 预发布。**macOS** 是主路径。**glibc Linux**（x64 / arm64）部分测试。**Windows** 原生开发中。安装包未签名。

### 直接下载

| 平台 | 下载 | 安装方式 |
| --- | --- | --- |
| macOS | [下载 DMG](https://github.com/kai2002/fast/releases/latest) | 打开 DMG，运行 `Install Fast.pkg` → `/Applications` + `/usr/local/bin` shim |
| Linux（glibc，x64 / arm64） | [下载](https://github.com/kai2002/fast/releases/latest) | 解压 `dir` 包。部分测试。不支持 Alpine / musl |
| Windows | — | 开发中。请用 WSL2，按 Linux 对待 |
| Android | [下载 APK](https://github.com/kai2002/fast/releases/latest) | `adb install` 配套 APK，再与桌面配对 |
| iOS | — | 配套客户端，走 Expo / 源码；与桌面配对 |
| CLI（TUI） | [下载](https://github.com/kai2002/fast/releases/latest) | 解压 `fast-ink` + `fast-cli`（别名 `fast`） |

打包方式见 [通过源码安装](#通过源码安装)。

### 通过源码安装

| 需要    | 版本                                     |
| ------- | ---------------------------------------- |
| Node.js | 20.19+ 或 22                             |
| pnpm    | 9（`package.json` 里的 `packageManager`） |
| JDK     | 17+（仅桌面 / TUI 引擎）                 |
| Maven   | 3.x（仅桌面 / TUI 引擎）                 |

Linux 还需要编译 `node-pty` 的工具链（`build-essential`）、Electron 用的 GTK/NSS，以及 `lsof` / `procps`。手机额外依赖（Android SDK、Xcode）只在跑 App 时需要。

```bash
git clone https://github.com/kai2002/fast.git
cd fast
pnpm install
pnpm fetch-engine          # Maven Central → modules/engine/current/
pnpm pack                  # 桌面 + CLI + 手机，JS/引擎只 stage 一次
```

这是主路径。默认为增量（已有 `current/` 就复用；**不检查 OS** — 换主机后用 `--clean`）。不要在机器之间拷贝 `current/`。

`pnpm pack` 的产物：

- **macOS** — dmg 里未签名 pkg（`Install Fast.pkg` → `/Applications` + `/usr/local/bin` shim）
- **Linux** — 解压 `dir`（部分测试）。不支持 Alpine / musl
- **Windows** — 开发中；请用 WSL2
- **CLI** — `release/cli`（`fast-ink` + `fast-cli`，别名 `fast`）
- **Android** — `release/fast-mobile-*.apk`（`adb install`）。没有 SDK：跳过，exit 0

只打一个产品，或干净重打：

```bash
pnpm pack:desktop          # 只打本机安装包
pnpm pack:cli              # 只打 release/cli
pnpm pack:mobile           # 只打 APK
pnpm pack -- --clean       # 重新拉引擎并 restage
```

`./build/all.sh` 与 `pnpm pack` 等价。每个 `build/*.sh` 都有 `--help`。日常 `dev/` 命令见 [开发](#开发)。

## 开发

`pnpm` 脚本调用 `dev/` 和 `build/` 下的文件，两种写法等价。每个脚本都有 `--help`。

### 快速开始

`pnpm dev:*` 和 `./dev/*.sh` 是一回事。第 1 步做完后，只跑你正在改的那一层。

1. **准备环境** — 克隆仓库、安装 JS 依赖，并把本机引擎下载到 `modules/engine/current/`。这份只能在当前系统用，不要从另一台机器拷过来。只改手机可以不做 `fetch-engine`。

```bash
git clone https://github.com/kai2002/fast.git
cd fast
pnpm install
pnpm fetch-engine
```

2. **开发桌面** — 对 `current/` 启动 Electron。`--mock` 只起界面、不连引擎。缺 `current/` 时加 `--engine` 会先下载再启动。

```bash
pnpm dev:desktop
pnpm dev:desktop:mock
./dev/desktop.sh --engine
```

3. **开发 TUI** — 对同一份 `current/` 启动 `fast-ink`。

```bash
pnpm dev:tui
./dev/tui.sh --engine
```

4. **开发手机** — 启动 Expo / Metro。加 `--android` 或 `--ios` 打开设备。

```bash
pnpm dev:mobile
./dev/mobile.sh --android
./dev/mobile.sh --ios
```

5. **刷新引擎** — 只在换了系统，或 `current/` 架构不对时做。

```bash
pnpm fetch-engine -- --clean
```

### 命令

完整列表。打安装包走 [通过源码安装](#通过源码安装)；这里日常是 `dev:*`，然后跑测试。

| 脚本                           | 作用                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| `pnpm fetch-engine`            | Maven Central `ai.fastllm` 0.3.0 → `modules/engine/current/` |
| `pnpm dev:desktop`             | `./dev/desktop.sh` — Electron 对 `current/`                  |
| `pnpm dev:desktop:mock`        | `./dev/desktop.sh --mock` — 仅 UI                            |
| `pnpm dev:tui`                 | `./dev/tui.sh` — `fast-ink` 对 `current/`                    |
| `pnpm dev:mobile`              | `./dev/mobile.sh` — Expo（`--android` / `--ios`）            |
| `pnpm pack`                    | CLI + 桌面 + 手机（`build/all.sh`，JS/引擎只 stage 一次）    |
| `pnpm pack:desktop`            | 本机安装包：macOS pkg/dmg；Linux `dir`（部分测试）；Windows 开发中 |
| `pnpm pack:cli`                | 可挪走的 `release/cli`（引擎 + TUI，无 Electron）            |
| `pnpm pack:mobile`             | Android APK；缺 JDK/SDK 则跳过（exit 0）                     |
| `pnpm build`                   | 编译 TypeScript 包 — 不是 `build/*.sh`                       |
| `pnpm test` / `pnpm typecheck` | 工作区测试 / 类型检查                                        |

提 PR 前跑测试和类型检查。TUI unix e2e 会向上查找 `current/bin/fast-cli`。Linux 上 TUI 出现豆腐块时设 `LANG=C.UTF-8`。

```bash
pnpm test
pnpm typecheck
```

补丁与 PR：[CONTRIBUTING.md](CONTRIBUTING.md)。漏洞：[SECURITY.md](SECURITY.md)（私下 advisory，不要开公开 issue）。这两份目前是英文。

### 代码结构

```text
fast/
  apps/desktop          Electron → core + web/ui
  apps/tui              fast-ink → core（无 DOM）
  apps/mobile           Expo 配套 → core（不 import web/ui）
  apps/web              预留；与桌面 renderer 同一套
  packages/core         无 DOM — bridge、session-view、i18n
    bridge/protocol     NDJSON schema
    bridge/client       ensureDaemon / IPC
    session-view        事件 → 视图模型
    i18n                文案 + resolve
  packages/web/ui       React 设计系统（桌面 + 以后的 web）
  dev/                  desktop.sh  tui.sh  mobile.sh
  build/                desktop.sh  cli.sh  mobile.sh  all.sh
  scripts/              fetch-engine.sh  pack-common.sh  …
  modules/engine        fetch-engine → current/bin/fast-cli（gitignore；别名 fast）
  extensions/           Maven 多模块（Wave 2 引擎插件）
```

分层：

- `packages/core` — 无界面。TUI 和手机只依赖这里。
- `packages/web` — React token 与控件。不是产品入口。
- `apps/*` — 可运行产品。桌面 renderer 是网页技术，宿主仍是 Electron。
- 目录布局不是安装布局。`apps/` 下没有必须打进 engine jar 的东西。

依赖：

- `session-view` / `bridge-client` → `bridge-protocol`
- `apps/tui` → core
- `apps/desktop` → core + `web/ui`
- `apps/mobile` → core（`i18n`、`session-view`）；不 import `web/ui`

npm 名（暂不改）：`@fastllm/bridge-protocol`、`@fastllm/bridge-client`、`@fast-ide/session-view`、`@fast-ide/i18n`、`@fast-ide/ui`。

`all.sh` 只 source 一次 `pack-common`（引擎 + JS + stage），再打 CLI 和桌面。手机不读引擎树。桌面和 CLI 都 `--skip` 时不 source pack-common。

更多：[doc/structure.md](doc/structure.md)、[modules/engine/README.md](modules/engine/README.md)。

## 截图

![Desktop](docs/screenshots/desktop.png)

桌面 — 项目、会话、本机引擎。

![TUI](docs/screenshots/tui.png)

TUI（`fast-ink`）— 同一引擎，走 unix Bridge。

<p align="center">
  <img src="docs/screenshots/mobile1.jpg" alt="手机会话" width="32%">
  <img src="docs/screenshots/mobile2.jpg" alt="手机设置，浅色" width="32%">
  <img src="docs/screenshots/mobile3.jpg" alt="手机设置，深色" width="32%">
</p>

手机 — 配套客户端：会话、与桌面 Bridge 配对、主题。

## 社区

选一个常用渠道讨论使用、开发和进展。

<div align="center">

| 微信群 | QQ 群 |
| :---: | :---: |
| <img src="docs/community/wechat.png" width="220" alt="微信群二维码"> | <img src="docs/community/qq.png" width="220" alt="QQ 群二维码"> |

Discord：[加入 Fast Agent](https://discord.gg/HXeK9QV57)

</div>

## 许可证

[Apache License 2.0](LICENSE)
