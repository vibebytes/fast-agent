# Contributing to Fast

This repo is the product shells (desktop, TUI, mobile) around a local coding agent. The JVM engine is `ai.fastllm` on Maven Central — Fast-only checkouts do not compile Scala and do not need an `agent/` tree.

Security reports go to [SECURITY.md](SECURITY.md), not public issues.

---

## Priorities

1. **Bug fixes** — crashes, wrong Bridge/session behavior, data loss.
2. **Host compatibility** — macOS and glibc Linux (x64 / arm64). Windows contributors: WSL2, treated as Linux.
3. **Security hardening** — Bridge auth, pairing tokens, path checks, secret logging. See [SECURITY.md](SECURITY.md).
4. **Tests and typecheck** — especially `packages/core` and unix Bridge e2e.
5. **Documentation** — README, `doc/structure.md`, script `--help` that matches implemented flags.

Features that belong in the engine (core tools, skills, agent loop) land in the `agent` repo, not here. Product-only JVM tools live in `extensions/<id>` as an external jar — see `agent/docs/features/tool/extension-tools.md`.

---

## Before you start

Search open and merged issues/PRs, then the source. The tracker can lag the tree.

```bash
gh search issues --repo vibebytes/fast-agent "<terms>"
gh search prs --repo vibebytes/fast-agent --state all "<terms>"
```

For larger work, comment on the issue first.

---

## Where to change it

| If you are changing… | Touch |
| --- | --- |
| NDJSON / IPC / daemon attach | `packages/core/bridge` |
| Transcript / approval view model | `packages/core/session-view` |
| Copy | `packages/core/i18n` (run `pnpm check:i18n`) |
| Shared React controls | `packages/web/ui` — desktop only; mobile and TUI must not import this |
| Electron host | `apps/desktop` |
| Terminal UI | `apps/tui` |
| Phone companion | `apps/mobile` |
| Dev / pack entry | `dev/*.sh`, `build/*.sh`, `scripts/` |
| Product JVM tools (quotes, search, …) | `extensions/<id>` |

`packages/core` must not import `packages/web`. Mobile does not read `modules/engine/current/`.

Layout detail: [doc/structure.md](doc/structure.md).

---

## Development setup

Official hosts: **macOS** and **glibc Linux**. Alpine / musl is not supported. Native Windows is not a daily-dev path.

| Need | Version |
| --- | --- |
| Node.js | 20.19+ or 22 |
| pnpm | 9 (`packageManager` in `package.json`) |
| JDK | 17+ to **fetch/pack** the engine only. `current/jre` is a Temurin 17 JRE |
| Maven | 3.x (desktop / TUI engine) |

Linux also needs a compiler toolchain for `node-pty` (`build-essential`), GTK/NSS for Electron, and `lsof` / `procps`.

```bash
pnpm install
pnpm fetch-engine
pnpm dev:desktop          # or ./dev/desktop.sh
```

`pnpm` scripts call `dev/` and `build/`. Engine output is only `modules/engine/current/` (gitignored). Do not commit it or copy it between OS families. Flags go after `--`: `--incremental` (default), `--clean`, `--os <os>` (`darwin-arm64` / `darwin-x64` / `linux-x64` / `linux-arm64` / `win32-x64` / `all`), `-h`. Incremental mode does not check the OS already in `current/`. Refresh or change OS:

```bash
pnpm fetch-engine -- --clean
pnpm fetch-engine -- --os darwin-arm64
```

Dev flags also go after `--`. `pnpm dev:desktop`: `--mock` (UI only; same as `pnpm dev:desktop:mock`), `--engine` (incremental fetch before start; also runs when `current/bin/fast-cli` is missing), `--stage` (local `sbt cli/Universal/stage` instead of Maven `current/`). Remaining args go to electron-vite. `pnpm dev:tui`: `--engine`, remaining args go to the TUI. `pnpm dev:mobile`: `--android` or `--ios` (only one), remaining args go to Expo; it does not read the engine tree. Unknown dev args are forwarded. `fetch-engine` and `build/*.sh` print help and exit 1 on an unknown arg. `-h` prints usage.

```bash
pnpm dev:desktop -- --mock
pnpm dev:desktop -- --engine
pnpm dev:desktop -- --stage
pnpm dev:tui -- --engine
pnpm dev:mobile -- --ios
```

### Checks

```bash
pnpm test
pnpm typecheck
pnpm check:i18n
```

TUI unix e2e walks up to `modules/engine/current/bin/fast-cli`. Linux: `LANG=C.UTF-8` if the TUI shows tofu instead of CJK.

`pnpm build` compiles TypeScript packages. It is not `build/*.sh`. Pack flags go after `--`. `pnpm pack` / `pack:desktop` / `pack:cli`: `--incremental` (default; reuse `current/` only when `.fast-os` matches — mismatch fails, use `--clean`), `--clean`, `--os` (`darwin-arm64` / `darwin-x64` / `darwin-both` / `linux-x64` / `linux-arm64` / `win32-x64`, plus `darwin` / `linux` / `windows`). `darwin-both` runs both mac packs (each pass `--clean`). `pnpm pack` also takes repeatable `--skip desktop|cli|mobile`. `pnpm pack:desktop` also takes `--smoke` (check an existing `--os` output; no fetch, no rebuild). CLI writes `release/cli-<os>` (`cli-darwin-arm64` / `cli-darwin-x64` / `cli-linux-x64` / `cli-linux-arm64` / `cli-win32-x64`); `release/cli` → last pack. `pnpm pack:mobile` does not read the engine: `--incremental`, `--clean`, `--prebuild`, `--debug`, `--arch` (`armeabi-v7a` / `arm64-v8a` / `x86` / `x86_64` / `all`), `--os android`. Desktop and CLI are single-arch packs, not universal. Linux desktop is AppImage (`Fast-*-linux-x64.AppImage` / `Fast-*-linux-arm64.AppImage`; also writes `linux-unpacked` / `linux-arm64-unpacked`). Windows desktop is NSIS (`Fast-*-win-x64.exe`; also writes `win-unpacked`). Alpine / musl is not supported. Windows native is in development; a Mac can emit the installer but must not run it or `Fast.exe`.

---

## Pull requests

### Before you open one

1. Run `pnpm test` and `pnpm typecheck`.
2. Exercise the surface you changed (`./dev/desktop.sh`, `./dev/tui.sh`, or `./dev/mobile.sh`).
3. One logical change per PR.
4. If the change is security-sensitive, say so in the description and read [SECURITY.md](SECURITY.md).

### Description

- What changed and why
- How to test
- Hosts you ran (darwin-arm64, linux-x64, …)

### Commits

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <description>`

| Type | Use for |
| --- | --- |
| `fix` | Bug fixes |
| `feat` | New behavior |
| `docs` | Documentation |
| `test` | Tests |
| `refactor` | No behavior change |
| `build` / `chore` | Scripts, pack, deps |

Scopes that match this tree: `desktop`, `tui`, `mobile`, `bridge`, `engine`, `pack`, `i18n`.

Examples:

```text
fix(bridge): do not attach unix continue to a stripped session id
docs: point layout notes at doc/structure.md
build: fetch-engine --incremental skips Maven when current/ exists
```

---

## Issues

Use GitHub Issues. Include OS, Node version, `pnpm fetch-engine` / `current/.fast-os` if the engine is involved, and steps to reproduce.

Do not file public issues for vulnerabilities.

---

## License

Contributions are under [Apache License 2.0](LICENSE).
