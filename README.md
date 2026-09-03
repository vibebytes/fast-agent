![Fast Agent — An enterprise-grade, self-improving AI agent with coding as a first-class citizen.](docs/hero.png?v=5)

**An enterprise-grade, self-improving AI agent with coding as a first-class citizen.**

![Release](https://img.shields.io/badge/release-v0.3.1-blue)![License](https://img.shields.io/badge/license-Apache%202.0-brightgreen)![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows%20%7C%20Android%20%7C%20iOS-informational)![Discord](https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white)

[English](README.md) | [中文](README.zh-CN.md)

[1. Download](#1-download-and-install) · [1.1 Packs](#11-direct-download) · [1.2 Mobile](#12-how-to-use-the-mobile-client-experimental-under-active-development) · [1.3 Source](#13-install-from-source) · [2. Development](#2-development) · [2.1 Quick start](#21-quick-start) · [3. Screenshots](#3-screenshots) · [4. Community](#4-community) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [5. License](#5-license)

Fast Agent's goal is to be an enterprise-grade, self-improving AI agent with coding as a first-class citizen.

- **Enterprise-grade** – provides reviewable, manageable, and observable capabilities for code review, rollback, and tracing.
- **Self-improving** – continuously learns from project experience, each task better than the last.
- **Coding-first** – directly edits, runs, and lands code, not just talks about it.
- **Cluster & Remote** – supports multi-agent collaboration and remote task orchestration with distributed execution.
- **Agent-native** – all components are agents, autonomously collaborating and highly composable.

> [!IMPORTANT]
> Fast Agent is **under active development** (v0.3.1). The local engine can edit your workspace and run shell. Review every approval, expect breaking changes, and do not treat unsigned packs as a production release. Software is provided as-is under [Apache 2.0](LICENSE).

## 1. Download and install

v0.3.1 pre-release. **macOS** is the primary host. **Windows** native is in development. Packs are unsigned.

### 1.1 Direct download


| Type    | Platform              | Download                                                                           | Installation                                                                             | Test status | Build command                                    |
| ------- | --------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------ |
| Desktop | macOS (Apple Silicon) | [Download `Fast-*-mac-arm64.dmg`](https://github.com/kai2002/fast-agent/releases) | Open the DMG and run `Install Fast.pkg` → `/Applications` + `/usr/local/bin` shims       | Good        | `pnpm pack:desktop -- --clean --os darwin-arm64` |
| Desktop | macOS (Intel)         | [Download `Fast-*-mac-x64.dmg`](https://github.com/kai2002/fast-agent/releases)   | Same as Apple Silicon. Separate pack — not universal                                     | Good        | `pnpm pack:desktop -- --clean --os darwin-x64`   |
| Desktop | Linux (glibc x64)     | N/A (unverified)                                                                   | `chmod +x Fast-*-linux-x64.AppImage` and run. Alpine / musl is not supported             | Untested    | `pnpm pack:desktop -- --clean --os linux-x64`    |
| Desktop | Linux (glibc arm64)   | N/A (unverified)                                                                   | Same as Linux x64 (`Fast-*-linux-arm64.AppImage`). Separate pack — not universal         | Untested    | `pnpm pack:desktop -- --clean --os linux-arm64`  |
| Desktop | Windows (x64)         | N/A (unverified)                                                                   | Run `Fast-*-win-x64.exe` (NSIS) → Fast.exe + user PATH shims. Unsigned. In development   | Untested    | `pnpm pack:desktop -- --clean --os win32-x64`    |
| Mobile  | Android               | [Download `fast-mobile-*.apk`](https://github.com/kai2002/fast-agent/releases)    | `adb install` the companion APK, then pair with desktop                                  | Good        | `pnpm pack:mobile`                               |
| Mobile  | iOS                   | N/A (unverified)                                                                   | Companion via Expo / from source (Xcode, macOS). Pair with desktop. No IPA pack          | Untested    | `pnpm --dir apps/mobile ios`                     |
| CLI     | macOS (Apple Silicon) | N/A (unverified)                                                                   | Unpack `fast-cli` (alias `fast`)                                                         | Partial     | `pnpm pack:cli -- --clean --os darwin-arm64`     |
| CLI     | macOS (Intel)         | N/A (unverified)                                                                   | Same as Apple Silicon. Separate pack                                                     | Untested    | `pnpm pack:cli -- --clean --os darwin-x64`       |
| CLI     | Linux (glibc x64)     | N/A (unverified)                                                                   | Unpack `fast-cli` (alias `fast`). Alpine / musl is not supported            | Untested    | `pnpm pack:cli -- --clean --os linux-x64`        |
| CLI     | Linux (glibc arm64)   | N/A (unverified)                                                                   | Same as Linux x64. Separate pack                                                         | Untested    | `pnpm pack:cli -- --clean --os linux-arm64`      |
| CLI     | Windows (x64)         | N/A (unverified)                                                                   | Unpack `cli-win32-x64` (`fast-cli.bat`, alias `fast.bat`). In development                | Untested    | `pnpm pack:cli -- --clean --os win32-x64`        |


How packs are built: [1.3 Install from source](#13-install-from-source).

You can get help in the WeChat group or on Discord.




| WeChat | Discord |
| :---: | :---: |
| <img src="docs/community/weichat.jpg" width="180" alt="WeChat group"> | [Join Fast Agent](https://discord.gg/HXeK9QV57) |




### 1.2 How to use the mobile client (experimental, under active development)

The phone is a companion. It does not start an engine or edit files on the phone. Install the app first (Android: `adb install` the APK from the same release; iOS: Expo / from source, untested). Then pick a mode.

#### 1.2.1 LAN (desktop)

The phone talks to a desktop Fast that is already running, on the same LAN.

1. **Install desktop** on the computer ([1.1 Direct download](#11-direct-download)). macOS is the primary host.
2. **Turn on the LAN bridge**, then start desktop. A token is required. Default port is `8787`:

```bash
FAST_MOBILE_BRIDGE_TOKEN='your-secret' /Applications/Fast.app/Contents/MacOS/Fast
```

From source: prefix the same variable on `pnpm dev:desktop`. Optional: `FAST_MOBILE_BRIDGE_PORT`.

1. **Pair.** Desktop → Settings → Servers → Mobile pairing. On the phone: Settings → Scan to pair. You can paste the URL and token instead of scanning.

Guest Wi-Fi / client isolation, or a firewall blocking `8787`, will fail the connect. Desktop must stay running.

#### 1.2.2 Public network (remote CLI)

The phone talks to `fast-cli` on a remote Linux or macOS server. No desktop in the path.

1. **Fetch the engine** so `modules/engine/current/` exists. The tree must match the server OS and arch — do not later copy a Darwin `current/` onto Linux. `--clean` **replaces** local `current/`.

```bash
pnpm fetch-engine                          # host OS
pnpm fetch-engine -- --clean linux-x64     # Linux x64 tree (or linux-arm64)
```

1. **Upload** `modules/engine/current/` to the server (includes a Temurin 17 JRE). The server does not need a system JDK.
2. **Start the CLI** so it listens on the public interface. Non-loopback binds speak `wss` (TLS; auto-minted cert if you omit `--wss-cert` / `--wss-key`):

```bash
./bin/fast-cli engine --mode bridge --transport unix --wss 0.0.0.0:1979
```

1. **Read the token** on the server. Token goes in `Hello.authToken`, not in the URL:

```bash
cat ~/.fast/run/bridge.token
```

1. **Connect from the phone.** Settings → add server URL and token. URL is `wss://<host>:1979/bridge`. The client confirms the TLS fingerprint on its own.

Open `1979` (or the port you chose) on the host firewall / security group. Optional: `--wss-cert` / `--wss-key` for your own cert.

#### 1.2.3 After you are connected

Chat is the latest session. History lists sessions. A session can send, approve, and interrupt. Theme and language stay on the phone.

The pairing token is full access. Do not screenshot or share it. A lost phone is a leaked token — rotate the token and pair again. More: [SECURITY.md](SECURITY.md).

### 1.3 Install from source


| Need    | Version                                |
| ------- | -------------------------------------- |
| Node.js | 20.19+ or 22                           |
| pnpm    | 9 (`packageManager` in `package.json`) |
| JDK     | 17+ on the **pack** machine only (`fetch-engine` / Maven). The engine ships a Temurin 17 JRE |
| Maven   | 3.x (desktop / TUI engine only)        |


Linux also needs a compiler toolchain for `node-pty` (`build-essential`), GTK/NSS for Electron, and `lsof` / `procps`. Mobile extras (Android SDK, Xcode) only if you run the phone app.

```bash
git clone https://github.com/kai2002/fast-agent.git
cd fast-agent
pnpm install
pnpm fetch-engine          # Maven Central → modules/engine/current/
pnpm pack                  # desktop + CLI + mobile, one JS/engine stage
```

That is the main path. Incremental is the default: reuse `current/` if `.fast-os` matches. Mismatch fails — use `--clean`. Do not copy `current/` between machines. Engine natives and the Electron binary share `--os`. Not a universal binary. Desktop and CLI packs include the JRE; installing the app does not require a system JDK.

What `pnpm pack` writes:

- **macOS Apple Silicon** — unsigned `Fast-*-mac-arm64.dmg` (`Install Fast.pkg` → `/Applications` + `/usr/local/bin` shims)
- **macOS Intel** — unsigned `Fast-*-mac-x64.dmg` (same install). Separate pack
- **Linux glibc x64** — `Fast-*-linux-x64.AppImage` (`--os linux-x64`; also writes `linux-unpacked`). Alpine / musl is not supported. Can pack on macOS; do not run the AppImage there
- **Linux glibc arm64** — `Fast-*-linux-arm64.AppImage` (`--os linux-arm64`; also writes `linux-arm64-unpacked`). Separate pack
- **Windows x64** — unsigned NSIS `Fast-*-win-x64.exe` (`--os win32-x64`; also writes `win-unpacked`). Install adds user PATH shims. Can pack on macOS; do not run the installer or `Fast.exe` there. In development; WSL2 is the daily path
- **CLI** — `release/cli-darwin-arm64` / `cli-darwin-x64` / `cli-linux-x64` / `cli-linux-arm64` / `cli-win32-x64` (`fast-cli`, alias `fast`); `release/cli` → last pack
- **Android** — `release/fast-mobile-*.apk` (`adb install`). No SDK: skip, exit 0
- **iOS** — no IPA. `pnpm --dir apps/mobile ios` (`expo run:ios`; Xcode, macOS). Daily: `./dev/mobile.sh --ios`

One product, or a clean rebuild:

```bash
pnpm pack:desktop                              # host installer only
pnpm pack:desktop -- --clean --os darwin-arm64 # Apple Silicon
pnpm pack:desktop -- --clean --os darwin-x64   # Intel
pnpm pack:desktop -- --os darwin-both          # both mac packs (each pass --clean)
pnpm pack:desktop -- --clean --os linux-x64    # Linux glibc x64 (AppImage)
pnpm pack:desktop -- --clean --os linux-arm64  # Linux glibc arm64 (AppImage)
pnpm pack:desktop -- --clean --os win32-x64    # Windows x64 (NSIS)
pnpm pack:cli -- --os darwin-arm64             # release/cli-darwin-arm64
pnpm pack:cli -- --os darwin-x64               # release/cli-darwin-x64
pnpm pack:cli -- --os linux-x64                # release/cli-linux-x64
pnpm pack:cli -- --os linux-arm64              # release/cli-linux-arm64
pnpm pack:cli -- --os win32-x64                # release/cli-win32-x64
pnpm pack:mobile                               # APK only
pnpm --dir apps/mobile ios                     # iOS (Xcode; no IPA)
pnpm pack -- --clean                           # refetch engine and restage
```

`./build/all.sh` is the same as `pnpm pack` (`--os` works there too). Each `build/*.sh` has `--help`. Cross-arch smoke checks `file` and `.fast-os`; do not launch the foreign-arch `.app`, Linux dir, or `Fast.exe`. Daily `dev/` commands: [2. Development](#2-development).

## 2. Development

`pnpm` scripts call the files under `dev/` and `build/`. You can use either. Each script has `--help`.

### 2.1 Quick start

`pnpm dev:*` and `./dev/*.sh` are the same. After step 1, run only the step for the code you are changing.

1. **Prepare the environment** — clone, install JS dependencies, download the local engine into `modules/engine/current/`. That engine only works on the OS you fetched it on; do not copy the folder from another machine. Skip `fetch-engine` if you only change mobile.

```bash
git clone https://github.com/kai2002/fast-agent.git
cd fast-agent
pnpm install
pnpm fetch-engine
```

1. **Develop desktop** — start Electron against `current/`. `--mock` is the UI without the engine. `--engine` downloads `current/` first if it is missing.

```bash
pnpm dev:desktop
pnpm dev:desktop:mock
./dev/desktop.sh --engine
```

1. **Develop TUI** — start `fast-cli` against the same `current/`.

```bash
pnpm dev:tui
./dev/tui.sh --engine
```

1. **Develop mobile** — start Expo / Metro. Add `--android` or `--ios` to open a device.

```bash
pnpm dev:mobile
./dev/mobile.sh --android
./dev/mobile.sh --ios
```

1. **Refresh the engine** — only after you switch OS, or if `current/` is the wrong architecture.

```bash
pnpm fetch-engine -- --clean
```

### 2.2 Commands

Full list. Packing installers is [1.3 Install from source](#13-install-from-source); here you usually run `dev:*`, then tests.


| Script                         | What it does                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm fetch-engine`            | Maven Central `ai.fastllm` 0.3.0 → `modules/engine/current/`                                                                                                              |
| `pnpm dev:desktop`             | `./dev/desktop.sh` — Electron against `current/`                                                                                                                          |
| `pnpm dev:desktop:mock`        | `./dev/desktop.sh --mock` — UI only                                                                                                                                       |
| `pnpm dev:tui`                 | `./dev/tui.sh` — `fast-cli` against `current/`                                                                                                                            |
| `pnpm dev:mobile`              | `./dev/mobile.sh` — Expo (`--android` / `--ios`)                                                                                                                          |
| `pnpm pack`                    | CLI + desktop + mobile (`build/all.sh`). `--os` selects arch                                                                                                              |
| `pnpm pack:desktop`            | Host or `--os` installer. macOS: `Fast-*-mac-arm64.dmg` / `Fast-*-mac-x64.dmg`. Linux: `Fast-*-linux-x64.AppImage` / `Fast-*-linux-arm64.AppImage`. Windows: `Fast-*-win-x64.exe` (not universal) |
| `pnpm pack:cli`                | Relocatable `cli-darwin-arm64` / `cli-darwin-x64` / `cli-linux-x64` / `cli-linux-arm64` / `cli-win32-x64` (`release/cli` → last)                                          |
| `pnpm pack:mobile`             | Android APK; skips (exit 0) if JDK/SDK missing                                                                                                                            |
| `pnpm build`                   | Compile TypeScript packages — not `build/*.sh`                                                                                                                            |
| `pnpm test` / `pnpm typecheck` | Workspace tests / types                                                                                                                                                   |


Before a PR, run tests and types. TUI unix e2e walks up to `current/bin/fast-cli`. On Linux, set `LANG=C.UTF-8` if the TUI shows tofu instead of CJK.

```bash
pnpm test
pnpm typecheck
```

Patches and PR rules: [CONTRIBUTING.md](CONTRIBUTING.md). Vulnerabilities: [SECURITY.md](SECURITY.md) (private advisory, not a public issue).

### 2.3 Code structure

```text
fast/
  apps/desktop          Electron → core + web/ui
  apps/tui              fast-cli → core (no DOM)
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

## 3. Screenshots

![Desktop](docs/screenshots/desktop.png)

Desktop — projects, session, and the local engine.

![TUI](docs/screenshots/tui.png)

TUI (`fast-cli`) — same engine over a unix Bridge.

<p align="center">
  <img src="docs/screenshots/mobile1.jpg" width="180" alt="Mobile session">
  <img src="docs/screenshots/mobile2.jpg" width="180" alt="Mobile settings, light">
  <img src="docs/screenshots/mobile3.jpg" width="180" alt="Mobile settings, dark">
  <img src="docs/screenshots/mobile4.jpg" width="180" alt="Mobile theme palettes">
</p>

Mobile — companion client: session, desktop Bridge pairing, and themes.

## 4. Community

Use whichever channel you prefer for usage questions, development, and project updates.




| WeChat |
| :---: |
| <img src="docs/community/weichat.jpg" width="180" alt="WeChat group"> |


Discord: [Join Fast Agent](https://discord.gg/HXeK9QV57)



## 5. License

[Apache License 2.0](LICENSE)