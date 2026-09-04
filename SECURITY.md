# Fast Security Policy

This document is the trust model for the **Fast** shells (desktop, TUI, mobile) and the unix / LAN Bridge they attach to. The JVM engine is a separate artifact (`ai.fastllm`). Engine-only issues belong with that project unless a Fast path is what leaked or skipped a check.

Fast does not operate a bug bounty.

---

## 1. Reporting a vulnerability

Report privately via [GitHub Security Advisories](https://github.com/kai2002/fast/security/advisories/new). Do not open public issues for security vulnerabilities.

A useful report includes:

- A concise description and severity.
- Affected component (file path and line range).
- Environment: OS, Node, commit SHA, and whether `modules/engine/current/` is involved (plus `current/.fast-os`).
- Reproduction against `main` or the latest pack.
- Which trust boundary in §2 is crossed.

Read §2 and §3 first. Reports that only show a heuristic is incomplete (§2.4) are out of scope as advisories (§3.2) — file a normal issue or PR instead.

---

## 2. Trust model

Fast is a **single-operator** workbench. Desktop and TUI spawn or attach a local engine; mobile is a companion that talks to a desktop-hosted Bridge. Layers are not equally load-bearing.

### 2.1 Definitions

- **Engine process.** `modules/engine/current/bin/fast-cli` (alias `fast`, or `FAST_ENGINE_COMMAND`). Shell, tools, and skills run here. This repo does not compile that binary.
- **Shell process.** Electron (`apps/desktop`), `fast-ink` (`apps/tui`), or the Expo app (`apps/mobile`).
- **Bridge.** NDJSON session transport. Default on the host is a **unix socket** (Machine-scoped). Mobile uses a LAN WebSocket that the desktop process listens on.
- **Input surface.** Operator typing, project files, tool results, and anything the engine fetches. Mobile input is an input surface once paired.
- **Trust envelope.** What the operator’s OS user can already reach: home directory, project folders, the unix socket, and (if they enable it) the LAN Bridge.

### 2.2 The boundary: OS-level isolation

**The only security boundary against an adversarial LLM is the operating system** (process user, filesystem permissions, network policy). Approvals, UI redaction, and denylists in the shell are heuristics. They catch cooperative mistakes. They are not containment.

What Fast *does* treat as a boundary:

- **Unix Bridge (default).** The socket is local to the user. Another OS user, or a process without access to that socket, must not be able to attach, read session traffic, or resolve approvals.
- **Mobile / LAN Bridge.** Crossing the machine boundary requires a pairing token (and, on non-loopback, the TLS / pin path the desktop advertises). A caller without the token must not dispatch work or read the session. Binding `0.0.0.0` is an operator choice; it does not make the LAN a trusted network.

What Fast does **not** confine:

- Anything the engine does with the operator’s user account (shell, file tools, git).
- Prompt injection that only changes model text, unless it also crosses a §3.1 outcome.

### 2.3 Credentials

Keep provider keys and pairing tokens out of git (`.env` is gitignored). Do not log tokens, fingerprints, or `authToken` values.

The mobile companion stores server URL and token on the device. Treat a lost phone as a leaked pairing secret: rotate the desktop token / drop the pair.

`modules/engine/current/` is a downloaded runtime. Do not commit it. Do not copy it between OS families.

### 2.4 In-process heuristics

Useful. Not boundaries.

- **Approval UI** in desktop / TUI — the operator can still approve a destructive command.
- **Display folding / redaction** — a motivated model transcript will get past it.
- **Mock engine** (`./dev/desktop.sh --mock`) — UI only; never treat it as a sandbox for untrusted prompts.

### 2.5 Extensions

`extensions/` (Maven Wave 2) loads into the engine, not the Electron renderer. A third-party engine plugin runs with engine privileges. The boundary is operator review before you put a jar on the engine class path. A malicious plugin is not by itself a vulnerability in Fast; bugs that hide what is being loaded are in scope under §3.1.

### 2.6 External surfaces

| Surface | Trust boundary | Rule |
| --- | --- | --- |
| Unix socket | Local OS user | Permissions must not expose the socket to other users. |
| Desktop renderer IPC | Same desktop process | Do not treat `ipcRenderer` as a network API. |
| Mobile LAN `ws` / `wss` | Network | Token (and pin on TLS) required. Fail closed if the token is missing. |
| Loopback vs LAN | Operator | Loopback is the safer default. Non-loopback is break-glass; harden as in §4. |

Session ids are routing handles, not capability tokens. Knowing a session id must not skip pairing / unix access checks.

---

## 3. Scope

### 3.1 In scope

- Unauthorized Bridge attach: a caller outside the unix-user or pairing-token set reading traffic, sending turns, or resolving approvals.
- Pairing / pin bypass: connecting to the LAN Bridge without the token, or accepting a different server identity than the pinned fingerprint.
- Credential leak: tokens, keys, or pairing material written to logs, pack artifacts, or a destination outside the trust envelope by a path that should have stripped them.
- Path / IPC confusion: a shell or renderer path that reads or writes outside the operator-selected project when the code claimed it would not.
- Documented stance violations: e.g. code that treats unix as optional auth, or that fails open when `authToken` is empty on a LAN listener.

### 3.2 Out of scope

Not an advisory. Still fine as a normal issue or PR.

- **Prompt injection per se** with no §3.1 outcome.
- **Bypassing approval copy or UI heuristics** (§2.4).
- **Engine tool effects the OS user is allowed to do** (the local engine is supposed to run shell as you).
- **Copying `current/` between machines** or running a Darwin engine on Linux — operator error; `--clean` and refetch.
- **Unsigned macOS pkg/dmg** and sideloaded APKs — current pack does not claim notarization or Play signing.
- **Public LAN Bridge without token rotation** after the operator bound `0.0.0.0` and shared the QR — that is the flag’s job; missing *code* that skips the token is §3.1.

---

## 4. Hardening

- Run desktop / TUI as your normal user, not root.
- Prefer unix Bridge on the same host. Desktop does not open a LAN port by default. `FAST_MOBILE_BRIDGE=1` makes **this** local spawn pass `--wss 0.0.0.0:1979`. The token is `bridge.token` (`~/.fast/run/bridge.token`), not a second file in userData.
- Confirm the TLS fingerprint in Settings before trusting a non-loopback desktop.
- Do not paste pairing tokens into issues, screenshots, or chat.
- Review `extensions/` jars the same way you review a native binary.
- `pnpm fetch-engine` only from Maven Central `ai.fastllm` as wired in `scripts/fetch-engine.sh`. Do not point product paths at random zips.

---

## 5. Disclosure

- **Window:** 90 days from the report, or until a fix is released, whichever comes first.
- **Channel:** the GitHub Security Advisory thread.
- **Credit:** reporters are named in release notes unless they ask not to be.

---

## 6. Contributing security-sensitive code

See [CONTRIBUTING.md](CONTRIBUTING.md). In addition:

- Do not log secrets.
- LAN listeners fail closed without a token.
- Tests for attach / pairing live next to the change (`GetBridgePairing` / `WorkspaceHub`, `desktopHost`, unix e2e).
- Mark the PR as security-sensitive in the description.
