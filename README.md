<div align="center">
  <img src="docs/hero.png?v=5" alt="Fast Agent — Open-Source Muse & Grok with an Orchestrated Fleet of Coding Assistants" width="100%">
  <h1>Fast Agent</h1>
  <p><strong>The Open-Source Muse & Grok Companion with an Orchestrated Fleet of Coding Assistants.</strong></p>

  <p>
    <a href="https://github.com/kai2002/fast-agent/releases"><img alt="Release" src="https://img.shields.io/badge/release-v0.3.1-blue"></a>
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-brightgreen"></a>
    <img alt="Platforms" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows%20%7C%20Android%20%7C%20iOS-informational">
    <a href="https://discord.gg/HXeK9QV57"><img alt="Discord" src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white"></a>
  </p>

  <p>
    <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
  </p>
</div>

---

**Fast Agent** reimagines personal AI assistance and software engineering. It combines the seamless, proactive companion experience of **Muse / Cue**, the raw speed and direct action of **Grok**, and a full **multi-agent orchestration engine** that lets you command an entire fleet of specialized AI engineers right from your desktop, terminal, or phone.

> [!IMPORTANT]
> Fast Agent is **under active development** (v0.3.1). The local engine directly interacts with your workspace and runs approved shell tasks. Review all approvals and enjoy the bleeding edge!

---

## 🚀 Highlights: Why Fast Agent?

### 1. 👥 Command a Fleet of AI Assistants (Cluster & Multi-Agent)
No single AI can master every domain. Fast Agent lets you recruit, organize, and orchestrate specialized AI roles:
- **Team Leadership**: Spin up an architect, coder, tester, and reviewer in a single workspace.
- **Autonomous Collaboration**: Agents plan, delegate sub-goals, run checks, and critique each other's deliverables.
- **Scale Across Nodes**: Run tasks locally or orchestrate across your remote cluster servers seamlessly.

### 2. 💻 Coding as a First-Class Citizen
Not just chat answers or code snippets in markdown — Fast Agent lives inside the loop:
- **Inspect, Edit, & Land**: Reads repos, plans diffs, applies precise syntax edits, and verifies builds.
- **Enterprise-Grade Safety**: Full visual diff inspection, reviewable checkpoint ledger, and one-click rollback.
- **Zero Hallucination Loop**: Runs tests, catches compiler errors, and self-improves until tasks pass acceptance criteria.

### 3. 📱 Anywhere Companion (Desktop, Mobile, & TUI)
- **Workstation Powerhouse**: A full-featured desktop workbench with diff viewers, file explorer, session tabs, and agent graph tracking.
- **Mobile Remote Controller**: On the go? Control your desktop or cloud engine right from your phone. Assign complex coding goals, monitor terminal live logs, and approve pull-requests anywhere.
- **Hacker-Friendly TUI**: Ultra-responsive, low-latency command-line interface for SSH and minimalists.

### 4. 🔌 Pluggable Multi-Engine Runtime
Switch engines per session on the fly. Fast Agent ships with its high-performance native engine, while supporting external backends such as **DeepSeek DSH** and modular plugins.

---

## 📸 See It in Action

<div align="center">
  <h3>Desktop Workbench — Multi-Agent Collaboration & Visual Diff Review</h3>
  <img src="docs/screenshots/desktop.png" width="90%" alt="Fast Desktop Workbench">
</div>

<br/>

<div align="center">
  <h3>Mobile Companion — Remote Command, Live Streams & One-Tap Approval</h3>
  <p align="center">
    <img src="docs/screenshots/mobile1.jpg" width="22%" alt="Mobile session">
    <img src="docs/screenshots/mobile2.jpg" width="22%" alt="Mobile settings, light">
    <img src="docs/screenshots/mobile3.jpg" width="22%" alt="Mobile settings, dark">
    <img src="docs/screenshots/mobile4.jpg" width="22%" alt="Mobile theme palettes">
  </p>
</div>

<br/>

<div align="center">
  <h3>TUI Terminal — Blazing Fast, Pure Unix Bridge</h3>
  <img src="docs/screenshots/tui.png" width="90%" alt="Fast TUI">
</div>

---

## ⚡ Quick Start: 30 Seconds to Launch

### 1. Download Pre-built Apps

Get ready-to-run releases from [GitHub Releases](https://github.com/kai2002/fast-agent/releases):

| Platform | Package | How to Install |
| :--- | :--- | :--- |
| **macOS (Apple Silicon)** | `Fast-*-mac-arm64.dmg` | Open DMG → Run `Install Fast.pkg` |
| **macOS (Intel)** | `Fast-*-mac-x64.dmg` | Open DMG → Run `Install Fast.pkg` |
| **Android** | `fast-mobile-*.apk` | Install APK on phone → Pair with desktop |
| **Linux (x64 / arm64)** | `Fast-*-linux-*.AppImage` | `chmod +x *.AppImage` and run (glibc) |
| **Windows (x64)** | `Fast-*-win-x64.exe` | Run NSIS installer *(In active development)* |

### 2. Pair Your Mobile Companion in 2 Steps

1. **Open Desktop App**: Navigate to `Settings` → `Servers` → Turn on **Mobile pairing**.
2. **Scan from Phone**: Open the Fast Mobile companion, tap **Scan to pair**, and point at the QR code.
3. *Remote or on cellular?* Switch to the **Cloudflare Tunnel** tab on Desktop to generate a secure zero-config public link and pair from anywhere without public IPs or port forwarding!

---

## 🛠️ Developer & Contributor Guide

Fast Agent is built with a modular monorepo: TypeScript/React frontend, Electron/Expo clients, and a high-throughput multi-agent engine kernel.

### Repository Architecture

```text
fast/
  apps/desktop          Electron desktop app (Renderer + Bridge IPC)
  apps/tui              fast-cli interactive terminal client
  apps/mobile           Expo React Native companion (Android / iOS)
  packages/core         Headless bridge protocol, session-view & i18n
  packages/web/ui       Shared React design system
  modules/engine        High-performance agent engine & bundled JRE
  extensions/           Pluggable engine plugins (e.g., DeepSeek DSH)
```

### Environment Requirements

| Requirement | Version | Note |
| :--- | :--- | :--- |
| **Node.js** | 20.19+ or 22 | Runtime for apps & packages |
| **pnpm** | 9 | Package manager |
| **JDK** | 17+ | Only required on builder machine running `fetch-engine` |
| **Maven** | 3.x | Only needed if building engine extensions |

### Development Workflow

```bash
# 1. Clone repository & install dependencies
git clone https://github.com/kai2002/fast-agent.git
cd fast-agent
pnpm install

# 2. Fetch the pre-built engine binary
pnpm fetch-engine

# 3. Start developing your target surface
pnpm dev:desktop       # Run Desktop Electron app
pnpm dev:tui           # Run TUI terminal app
pnpm dev:mobile        # Run Mobile client (Expo / Metro)
```

### Running Tests

```bash
pnpm test              # Run unit & e2e test suites
pnpm typecheck         # Verify TypeScript types across packages
```

<details>
<summary><b>📦 Production Packaging Commands (Click to expand)</b></summary>

```bash
# Full multi-target package
pnpm pack

# Individual target packaging
pnpm pack:desktop                              # Host platform installer
pnpm pack:desktop -- --clean --os darwin-arm64 # Apple Silicon
pnpm pack:desktop -- --clean --os darwin-x64   # Intel macOS
pnpm pack:desktop -- --clean --os linux-x64    # Linux AppImage
pnpm pack:desktop -- --clean --os win32-x64    # Windows NSIS
pnpm pack:cli                                  # Relocatable fast-cli
pnpm pack:mobile                               # Android APK
```
</details>

---

## 💬 Community & Support

Join our growing community to exchange agent prompts, share custom workflows, or get direct support from the maintainers:

<div align="center">
  <table>
    <tr>
      <td align="center">
        <b>WeChat Group (微信群)</b><br/><br/>
        <img src="docs/community/weichat.jpg" width="180" alt="WeChat group">
      </td>
      <td align="center" width="260">
        <b>Discord Community</b><br/><br/>
        <a href="https://discord.gg/HXeK9QV57">
          <img src="https://img.shields.io/badge/Discord-Join%20Fast%20Agent-5865F2?logo=discord&logoColor=white&style=for-the-badge" alt="Join Discord">
        </a>
      </td>
    </tr>
  </table>
</div>

---

## 📄 License & Security

- **License**: Released under the [Apache License 2.0](LICENSE).
- **Contributing**: Check out [CONTRIBUTING.md](CONTRIBUTING.md) to get involved.
- **Security**: Please report vulnerabilities privately via [SECURITY.md](SECURITY.md).
