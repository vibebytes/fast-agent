<div align="center">
  <img src="docs/hero.png?v=5" alt="Fast Agent — An enterprise-grade, self-improving AI agent with coding as a first-class citizen." width="100%">
</div>

<p align="center">
  <strong>An enterprise-grade, self-improving AI agent with coding as a first-class citizen.</strong>
</p>

<p align="center">
  <a href="#1-download-and-install"><img alt="User Guide" src="https://img.shields.io/badge/📘_USER_GUIDE-v0.0.1_·_ENGLISH-2563eb?style=for-the-badge"></a>
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
  <a href="#1-download-and-install">1. Download</a> ·
  <a href="#11-direct-download">1.1 Packs</a> ·
  <a href="#12-how-to-use-the-mobile-client-experimental-under-active-development">1.2 Mobile</a> ·
  <a href="#13-install-from-source">1.3 Source</a> ·
  <a href="#2-development">2. Development</a> ·
  <a href="#21-quick-start">2.1 Quick start</a> ·
  <a href="#3-screenshots">3. Screenshots</a> ·
  <a href="#4-community">4. Community</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="#5-license">5. License</a>
</p>

Fast Agent's goal is to be an enterprise-grade, self-improving AI agent with coding as a first-class citizen.

- **Enterprise-grade** – provides reviewable, manageable, and observable capabilities for code review, rollback, and tracing.
- **Self-improving** – continuously learns from project experience, each task better than the last.
- **Coding-first** – directly edits, runs, and lands code, not just talks about it.
- **Cluster & Remote** – supports multi-agent collaboration and remote task orchestration with distributed execution.
- **Agent-native** – all components are agents, autonomously collaborating and highly composable.

> [!IMPORTANT]
> Fast Agent is **under active development** (v0.0.1). The local engine can edit your workspace and run shell. Review every approval, expect breaking changes, and do not treat unsigned packs as a production release. Software is provided as-is under [Apache 2.0](LICENSE).

## 1. Download and install

v0.0.1 pre-release. **macOS** is the primary host. **Windows** native is in development. Packs are unsigned.

### 1.1 Direct download

| Platform | Download | Installation | Test status |
| --- | --- | --- | --- |
| macOS | [Download DMG](https://github.com/kai2002/fast/releases/latest) | Open the DMG and run `Install Fast.pkg` → `/Applications` + `/usr/local/bin` shims | Good |
| Linux (glibc, x64 / arm64) | [Download](https://github.com/kai2002/fast/releases/latest) | Unpack the `dir` pack. Alpine / musl is not supported | Untested |
| Windows | — | In development. Use WSL2 and treat it as Linux | Untested |
| Android | [Download APK](https://github.com/kai2002/fast/releases/latest) | `adb install` the companion APK, then pair with desktop | Good |
| iOS | — | Companion via Expo / from source; pair with desktop | Untested |
| CLI (TUI) | [Download](https://github.com/kai2002/fast/releases/latest) | Unpack `fast-ink` + `fast-cli` (alias `fast`) | Partial |

How packs are built: [1.3 Install from source](#13-install-from-source).

You can get help in the WeChat group or on Discord.

<div align="center">

| WeChat | Discord |
| :---: | :---: |
| <img src="docs/community/weichat.jpg" width="220" alt="WeChat group"> | [Join Fast Agent](https://discord.gg/HXeK9QV57) |

</div>

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

3. **Pair.** Desktop → Settings → Servers → Mobile pairing. On the phone: Settings → Scan to pair. You can paste the URL and token instead of scanning.

Guest Wi-Fi / client isolation, or a firewall blocking `8787`, will fail the connect. Desktop must stay running.

#### 1.2.2 Public network (remote CLI)

The phone talks to `fast-cli` on a remote Linux or macOS server. No desktop in the path.

1. **Fetch the engine** so `modules/engine/current/` exists. The tree must match the server OS and arch — do not later copy a Darwin `current/` onto Linux. `--clean` **replaces** local `current/`.

```bash
pnpm fetch-engine                          # host OS
pnpm fetch-engine -- --clean linux-x64     # Linux x64 tree (or linux-arm64)
```

2. **Upload** `modules/engine/current/` to the server. The server needs **JDK 17+**.
3. **Start the CLI** so it listens on the public interface. Non-loopback binds speak `wss` (TLS; auto-minted cert if you omit `--wss-cert` / `--wss-key`):

```bash
./bin/fast-cli engine --mode bridge --transport unix --wss 0.0.0.0:1979
```

4. **Read the token** on the server. Token goes in `Hello.authToken`, not in the URL:

```bash
cat ~/.fast/run/bridge.token
```

5. **Connect from the phone.** Settings → add server URL and token. URL is `wss://<host>:1979/bridge`. The client confirms the TLS fingerprint on its own.

Open `1979` (or the port you chose) on the host firewall / security group. Optional: `--wss-cert` / `--wss-key` for your own cert.

#### 1.2.3 After you are connected

Chat is the latest session. History lists sessions. A session can send, approve, and interrupt. Theme and language stay on the phone.

The pairing token is full access. Do not screenshot or share it. A lost phone is a leaked token — rotate the token and pair again. More: [SECURITY.md](SECURITY.md).

### 1.3 Install from source

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

`./build/all.sh` is the same as `pnpm pack`. Each `build/*.sh` has `--help`. Daily `dev/` commands: [2. Development](#2-development).

## 2. Development

`pnpm` scripts call the files under `dev/` and `build/`. You can use either. Each script has `--help`.

### 2.1 Quick start

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

### 2.2 Commands

Full list. Packing installers is [1.3 Install from source](#13-install-from-source); here you usually run `dev:*`, then tests.

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

### 2.3 Code structure

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

## 3. Screenshots

![Desktop](docs/screenshots/desktop.png)

Desktop — projects, session, and the local engine.

![TUI](docs/screenshots/tui.png)

TUI (`fast-ink`) — same engine over a unix Bridge.

<p align="center">
  <img src="docs/screenshots/mobile1.jpg" alt="Mobile session" width="24%">
  <img src="docs/screenshots/mobile2.jpg" alt="Mobile settings, light" width="24%">
  <img src="docs/screenshots/mobile3.jpg" alt="Mobile settings, dark" width="24%">
  <img src="docs/screenshots/mobile4.jpg" alt="Mobile theme palettes" width="24%">
</p>

Mobile — companion client: session, desktop Bridge pairing, and themes.

## 4. Community

Use whichever channel you prefer for usage questions, development, and project updates.

<div align="center">

| WeChat |
| :---: |
| <img src="docs/community/weichat.jpg" width="220" alt="WeChat group"> |

Discord: [Join Fast Agent](https://discord.gg/HXeK9QV57)

</div>

## 5. License

[Apache License 2.0](LICENSE)
