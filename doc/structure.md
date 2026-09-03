# Repository layout

```text
fast/
  modules/                         # sbt: engine does not depend on the shells
    engine/                        # fetch-engine → current/bin/fast-cli (gitignored; alias fast)
  extensions/                      # Maven multi-module (Wave 2): extension sources + engine dist assembly
                                   #   mvn -f extensions/pom.xml
    pom.xml                        # aggregator + parent POM (packaging=pom): groupId, Scala version, pluginManagement
    dsh-engine/                    # DSH extension (artifact: fast-engine-dsh): depends on agent-engine-api (provided);
                                   #   SPI declares EngineProvider
    example-engine/                # minimal sample engine: prove a new engine plugs in with zero core edits
    dist/                          # assembly: resolve agent-runtime + extension JARs
                                   #   → agent/  conf/engines.yaml  extensions/
  packages/                        # pnpm libraries, layered by dependency; core must not import web
    core/                          # no DOM; tui / desktop / web / mobile may all depend on this
      bridge/
        protocol/                  # NDJSON schema
        client/                    # ensureDaemon / IPC
      session-view/                # events → view model (directory name stays)
      i18n/                        # copy + resolve
    web/                           # React DOM only; desktop + future web
      ui/                          # tokens + controls
  apps/                            # product entries
    tui/                           # fast-ink → core
    desktop/                       # Electron → core + web/ui
    web/                           # later → core + web/ui
  dev/                             # desktop / tui / mobile development entries
  build/                           # desktop / cli / mobile / all packing entries
  scripts/                         # fetch-engine + pack-common and other bricks.
                                   # Do not compile the frontend from sbt.
```

## Layers

- `packages/core` — no UI. TUI and mobile only touch this layer.
- `packages/web` — React design system. Not an entry, and not a third top-level layer next to `apps/` / `packages/`.
- `apps/*` — runnable products. Desktop’s renderer is web tech; the host is still Electron.
- Directory ≠ packaged artifact. `apps/` is not “must be packed into the engine jar”.

## Dependencies

- `core/session-view` → `core/bridge/protocol`
- `core/bridge/client` → `core/bridge/protocol`
- `apps/tui` → core (`protocol` / `client` / `session-view`)
- `apps/desktop` → core + `web/ui`
- `apps/web` → core + `web/ui` (later)
- `apps/mobile` → core (`i18n` / `session-view`); does not import `web/ui`

## npm names (leave as-is for now)

- `@fastllm/bridge-protocol`  `@fastllm/bridge-client`
- `@fast-ide/session-view`  `@fast-ide/i18n`  `@fast-ide/ui`
- Later these can collapse to `@fast/session` and similar.

## Installers (sources sit side by side; artifacts merge)

- **Desktop** — `staging/pack` engine + TUI → `extraResources`; `Resources/bin` are in-app shims. Engine natives and the Electron binary share `--os`.
- **Distribution** — one dmg per mac arch (`Fast-*-mac-arm64.dmg` / `Fast-*-mac-x64.dmg`). Each contains `Install Fast.pkg` → `/Applications` + `/usr/local/bin`. Linux is AppImage (`Fast-*-linux-x64.AppImage` / `Fast-*-linux-arm64.AppImage`; also writes `linux-unpacked` / `linux-arm64-unpacked`). Windows is NSIS (`Fast-*-win-x64.exe`; also writes `win-unpacked`). Not universal.
- **Standalone CLI** — the same `staging/pack`, no Electron. One tree per arch (`release/cli-darwin-arm64` / `cli-darwin-x64` / `cli-linux-x64` / `cli-linux-arm64` / `cli-win32-x64`); `release/cli` → last pack.
- **DSH process** — vendor `@deepseek-ai/dsh` release (optional), not a git submodule.

## engine ↔ dsh

L0 extension model; contract lives in the `agent` repo: `docs/features/extensions/l0-engine.md`.

**Wave 1 (start):** `agent` ships a dist zip + `agent-dsh.jar`. Unzip into `modules/engine/`, drop the DSH jar into `engine/extensions/`. The `fast-cli` composition root constructs `DshBoot` and registers it in the Registry.

**Wave 2 (long term):** `extensions/` is a Maven multi-module (parent POM + `dsh-engine` + `dist`).

- `agent` `publishM2` publishes `agent-engine-api` / `agent-runtime` to `~/.m2`.
- `dsh-engine` depends only on `agent-engine-api` (`provided`). `META-INF/services` declares `EngineProvider`.
- `dist` assembles `agent/` `conf/engines.yaml` `extensions/<engineId>/`. Startup reads the YAML, discovers via SPI, and starts on demand.
- DSH is always an extension: engine sources do not import dsh, and there is no in-tree `dependsOn` fallback.
