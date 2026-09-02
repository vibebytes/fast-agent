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

Features that belong in the engine (tools, skills, agent loop) land in the `agent` repo, not here.

---

## Before you start

Search open and merged issues/PRs, then the source. The tracker can lag the tree.

```bash
gh search issues --repo kai2002/fast "<terms>"
gh search prs --repo kai2002/fast --state all "<terms>"
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

`packages/core` must not import `packages/web`. Mobile does not read `modules/engine/current/`.

Layout detail: [doc/structure.md](doc/structure.md).

---

## Development setup

Official hosts: **macOS** and **glibc Linux**. Alpine / musl is not supported. Native Windows is not a daily-dev path.

| Need | Version |
| --- | --- |
| Node.js | 20.19+ or 22 |
| pnpm | 9 (`packageManager` in `package.json`) |
| JDK | 17+ (desktop / TUI engine) |
| Maven | 3.x (desktop / TUI engine) |

Linux also needs a compiler toolchain for `node-pty` (`build-essential`), GTK/NSS for Electron, and `lsof` / `procps`.

```bash
pnpm install
pnpm fetch-engine
pnpm dev:desktop          # or ./dev/desktop.sh
```

`pnpm` scripts call `dev/` and `build/`. Engine output is only `modules/engine/current/` (gitignored). Do not commit it or copy it between OS families. Refresh or change OS:

```bash
pnpm fetch-engine -- --clean
```

UI without an engine: `pnpm dev:desktop:mock` / `./dev/desktop.sh --mock`.

Each `dev/*.sh` and `build/*.sh` lists implemented flags on `--help`. Unknown args print help on stderr and exit 1.

### Checks

```bash
pnpm test
pnpm typecheck
pnpm check:i18n
```

TUI unix e2e walks up to `modules/engine/current/bin/fast-cli`. Linux: `LANG=C.UTF-8` if the TUI shows tofu instead of CJK.

`pnpm build` compiles TypeScript packages. It is not `build/*.sh`. Packing: `pnpm pack:cli -- --incremental` (default is incremental). Incremental reuses `current/` only when `.fast-os` matches; mismatch fails — use `--clean`. Desktop and CLI are single-arch packs, not universal: `--os darwin-arm64` / `darwin-x64` / `linux-x64` / `linux-arm64` / `win32-x64`. CLI writes `release/cli-<os>` (`cli-darwin-arm64` / `cli-darwin-x64` / `cli-linux-x64` / `cli-linux-arm64` / `cli-win32-x64`); `release/cli` → last pack. `--os darwin-both` runs both mac packs (each pass `--clean`). Linux / Windows desktop is a `dir` (`linux-unpacked` / `linux-arm64-unpacked` / `win-unpacked`). Alpine / musl is not supported. Windows native is in development; a Mac can emit the dir but must not run `Fast.exe`.

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
