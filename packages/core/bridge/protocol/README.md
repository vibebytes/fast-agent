# @fastllm/bridge-protocol

Shared **Bridge** command/event contract for Engine clients (`cli-ink`, Fast IDE, future Web IDE).

## Exports

- `BridgeCommand` / `BridgeEvent` types
- `bridgeEventSchema` / `bridgeCommandSchema` (zod)
- `parseNdjsonChunk` (stdio NDJSON framing)

Engine remains the source of truth for wire behavior; this package is the TypeScript client schema.

## Hello / EnsureProject (Machine-scoped host)

Unix / npipe connections must handshake before other commands:

- **`Hello`** — `protocolVersion`, `clientId`, `clientKind` (`fast-ide` \| `fast-ink`), optional `cwd` / `authToken` (from `$FAST_RUN_DIR/bridge.token`). Daemon replies **`HelloOk`** (then legacy `ready`) or **`HelloReject`**.
- **`Goodbye`** / **`ClientHeartbeat`** — lease release / refresh (15s client interval).
- **`EnsureProject`** — idempotent folder Project + `RegisterWorkspace` (cli-ink cwd sharing). IDE adopts via `workspace_meta` fan-out; it does **not** need EnsureProject on boot.
- **`GetDaemonStatus`** / **`Shutdown`** — ops; normal stop is leases→0.
- **`daemon_shutting_down`** — host lifecycle event.

See `docs/features/machine-scoped-bridge-daemon.md` §6 / §9. Client connect/spawn lives in `@fastllm/bridge-client`.

## Develop

```bash
npm install
npm test
npm run build
```

Consumers depend via `file:` (monorepo) until published:

```json
"@fastllm/bridge-protocol": "file:../packages/bridge-protocol"
```
