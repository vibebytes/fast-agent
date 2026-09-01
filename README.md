<div align="center">
  <img src="docs/hero.png?v=5" alt="Fast Agent — An enterprise-grade, self-improving AI agent with coding as a first-class citizen." width="100%">
</div>

<p align="center">
  <strong>An enterprise-grade, self-improving AI agent with coding as a first-class citizen.</strong>
</p>

<p align="center">
  <a href="#download-and-install"><img alt="User Guide" src="https://img.shields.io/badge/📘_USER_GUIDE-v0.0.1_·_ENGLISH-2563eb?style=for-the-badge"></a>
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
  <a href="#direct-download">Download</a> ·
  <a href="#install-from-source">From source</a> ·
  <a href="#development">Development</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="#community">Community</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="#license">License</a>
</p>

Fast Agent's goal is to be an enterprise-grade, self-improving AI agent with coding as a first-class citizen.

- **Enterprise-grade** – provides reviewable, manageable, and observable capabilities for code review, rollback, and tracing.
- **Self-improving** – continuously learns from project experience, each task better than the last.
- **Coding-first** – directly edits, runs, and lands code, not just talks about it.
- **Cluster & Remote** – supports multi-agent collaboration and remote task orchestration with distributed execution.
- **Agent-native** – all components are agents, autonomously collaborating and highly composable.

> [!IMPORTANT]
> Fast Agent is **under active development** (v0.0.1). The local engine can edit your workspace and run shell. Review every approval, expect breaking changes, and do not treat unsigned packs as a production release. Software is provided as-is under [Apache 2.0](LICENSE).

## Download and install

v0.0.1 pre-release. **macOS** is the primary host. **glibc Linux** (x64 / arm64) is partially tested. **Windows** native is in development. Packs are unsigned.

### Direct download

| Platform | Download | Installation |
| --- | --- | --- |
| macOS | [Download DMG](https://github.com/kai2002/fast/releases/latest) | Open the DMG and run `Install Fast.pkg` → `/Applications` + `/usr/local/bin` shims |
| Linux (glibc, x64 / arm64) | [Download](https://github.com/kai2002/fast/releases/latest) | Unpack the `dir` pack. Partially tested. Alpine / musl is not supported |
| Windows | — | In development. Use WSL2 and treat it as Linux |
| Android | [Download APK](https://github.com/kai2002/fast/releases/latest) | `adb install` the companion APK, then pair with desktop |
| iOS | — | Companion via Expo / from source; pair with desktop |
| CLI (TUI) | [Download](https://github.com/kai2002/fast/releases/latest) | Unpack `fast-ink` + `fast-cli` (alias `fast`) |

How packs are built: [Install from source](#install-from-source).

### Install from source

| Need    | Version                                |
| ------- | -------------------------------------- |
| Node.js | 20.19+ or 22                           |
| pnpm    | 9 (`packageManager` in `package.json`) |
| JDK     | 17+ (desktop / TUI engine only)        |
| Maven   | 3.x (desktop / TUI engine only)        |

Linux also needs a compiler toolchain for `node-pty` (`build-essential`), GTK/NSS for Electron, and `lsof` / `procps`. Mobile extras (Android SDK, Xcode) only if you run the phone app.

```bash
git clone https://github.com/kai2002/fast.git
cd fast
pnpm install
pnpm fetch-engine          # Maven Central → modules/engine/current/
pnpm pack                  # desktop + CLI + mobile, one JS/engine stage
```

That is the main path. Incremental is the default (reuse `current/` if present; it does **not** check OS — use `--clean` after switching host). Do not copy `current/` between machines.

What `pnpm pack` writes:

- **macOS** — unsigned pkg inside a dmg (`Install Fast.pkg` → `/Applications` + `/usr/local/bin` shims)
- **Linux** — `dir` unpack (partially tested). Alpine / musl is not supported
- **Windows** — in development; use WSL2
- **CLI** — `release/cli` (`fast-ink` + `fast-cli`, alias `fast`)
- **Android** — `release/fast-mobile-*.apk` (`adb install`). No SDK: skip, exit 0

One product, or a clean rebuild:

```bash
pnpm pack:desktop          # host installer only
pnpm pack:cli              # release/cli only
pnpm pack:mobile           # APK only
pnpm pack -- --clean       # refetch engine and restage
```

`./build/all.sh` is the same as `pnpm pack`. Each `build/*.sh` has `--help`. Daily `dev/` commands: [Development](#development).

## Development

`pnpm` scripts call the files under `dev/` and `build/`. You can use either. Each script has `--help`.

### Quick start

`pnpm dev:*` and `./dev/*.sh` are the same. After step 1, run only the step for the code you are changing.

1. **Prepare the environment** — clone, install JS dependencies, download the local engine into `modules/engine/current/`. That engine only works on the OS you fetched it on; do not copy the folder from another machine. Skip `fetch-engine` if you only change mobile.

```bash
git clone https://github.com/kai2002/fast.git
cd fast
pnpm install
pnpm fetch-engine
```

2. **Develop desktop** — start Electron against `current/`. `--mock` is the UI without the engine. `--engine` downloads `current/` first if it is missing.

```bash
pnpm dev:desktop
pnpm dev:desktop:mock
./dev/desktop.sh --engine
```

3. **Develop TUI** — start `fast-ink` against the same `current/`.

```bash
pnpm dev:tui
./dev/tui.sh --engine
```

4. **Develop mobile** — start Expo / Metro. Add `--android` or `--ios` to open a device.

```bash
pnpm dev:mobile
./dev/mobile.sh --android
./dev/mobile.sh --ios
```

5. **Refresh the engine** — only after you switch OS, or if `current/` is the wrong architecture.

```bash
pnpm fetch-engine -- --clean
```

### Commands

Full list. Packing installers is [Install from source](#install-from-source); here you usually run `dev:*`, then tests.

| Script                         | What it does                                                 |
| ------------------------------ | ------------------------------------------------------------ |
| `pnpm fetch-engine`            | Maven Central `ai.fastllm` 0.3.0 → `modules/engine/current/` |
| `pnpm dev:desktop`             | `./dev/desktop.sh` — Electron against `current/`             |
| `pnpm dev:desktop:mock`        | `./dev/desktop.sh --mock` — UI only                          |
| `pnpm dev:tui`                 | `./dev/tui.sh` — `fast-ink` against `current/`               |
| `pnpm dev:mobile`              | `./dev/mobile.sh` — Expo (`--android` / `--ios`)             |
| `pnpm pack`                    | CLI + desktop + mobile (`build/all.sh`, one JS/engine stage) |
| `pnpm pack:desktop`            | Host installer: macOS pkg/dmg; Linux `dir` (partial); Windows in development |
| `pnpm pack:cli`                | Relocatable `release/cli` (engine + TUI, no Electron)        |
| `pnpm pack:mobile`             | Android APK; skips (exit 0) if JDK/SDK missing               |
| `pnpm build`                   | Compile TypeScript packages — not `build/*.sh`               |
| `pnpm test` / `pnpm typecheck` | Workspace tests / types                                      |

Before a PR, run tests and types. TUI unix e2e walks up to `current/bin/fast-cli`. On Linux, set `LANG=C.UTF-8` if the TUI shows tofu instead of CJK.

```bash
pnpm test
pnpm typecheck
```

Patches and PR rules: [CONTRIBUTING.md](CONTRIBUTING.md). Vulnerabilities: [SECURITY.md](SECURITY.md) (private advisory, not a public issue).

### Code structure

```text
fast/
  apps/desktop          Electron → core + web/ui
  apps/tui              fast-ink → core (no DOM)
  apps/mobile           Expo companion → core (no web/ui)
  apps/web              reserved; same stack as desktop renderer
  packages/core         no DOM — bridge, session-view, i18n
    bridge/protocol     NDJSON schema
    bridge/client       ensureDaemon / IPC
    session-view        events → view model
    i18n                strings + resolve
  packages/web/ui       React design system (desktop + future web)
  dev/                  desktop.sh  tui.sh  mobile.sh
  build/                desktop.sh  cli.sh  mobile.sh  all.sh
  scripts/              fetch-engine.sh  pack-common.sh  …
  modules/engine        fetch-engine → current/bin/fast-cli (gitignored; alias fast)
  extensions/           Maven multi-module (Wave 2 engine plugins)
```

Layers:

- `packages/core` — headless. TUI and mobile only import here.
- `packages/web` — React tokens and controls. Not a product entry.
- `apps/*` — runnable products. Desktop renderer is web tech; the host is still Electron.
- Directory layout is not the install layout. Nothing under `apps/` is required inside the engine jar.

Depends:

- `session-view` / `bridge-client` → `bridge-protocol`
- `apps/tui` → core
- `apps/desktop` → core + `web/ui`
- `apps/mobile` → core (`i18n`, `session-view`); does not import `web/ui`

npm names (unchanged for now): `@fastllm/bridge-protocol`, `@fastllm/bridge-client`, `@fast-ide/session-view`, `@fast-ide/i18n`, `@fast-ide/ui`.

`all.sh` sources `pack-common` once (engine + JS + stage), then packs CLI and desktop. Mobile does not read the engine tree. If both desktop and CLI are `--skip`, pack-common is not sourced.

More: [doc/structure.md](doc/structure.md), [modules/engine/README.md](modules/engine/README.md).

## Screenshots

![Desktop](docs/screenshots/desktop.png)

Desktop — projects, session, and the local engine.

![TUI](docs/screenshots/tui.png)

TUI (`fast-ink`) — same engine over a unix Bridge.

<p align="center">
  <img src="docs/screenshots/mobile1.jpg" alt="Mobile session" width="32%">
  <img src="docs/screenshots/mobile2.jpg" alt="Mobile settings, light" width="32%">
  <img src="docs/screenshots/mobile3.jpg" alt="Mobile settings, dark" width="32%">
</p>

Mobile — companion client: session, desktop Bridge pairing, and themes.

## Community

Use whichever channel you prefer for usage questions, development, and project updates.

<div align="center">

| WeChat | QQ |
| :---: | :---: |
| <img src="docs/community/wechat.png" width="220" alt="WeChat group"> | <img src="docs/community/qq.png" width="220" alt="QQ group"> |

Discord: [Join Fast Agent](https://discord.gg/HXeK9QV57)

</div>

## License

[Apache License 2.0](LICENSE)
