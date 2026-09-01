# @fastllm/bridge-client

Thin-client helpers for the **Machine-scoped Bridge host** (unix domain socket + NDJSON).

## API

| Export | Role |
| --- | --- |
| `bridgePaths` / `isStdioTransport` | Run dir / sock / pid / token from env (`FAST_RUN_DIR`, `FAST_BRIDGE_SOCK`, `FAST_BRIDGE_TRANSPORT`) |
| `ensureDaemon` | Spec §4.2: connect or spawn `fast-cli engine --mode bridge --transport unix` |
| `connectUnix` | NDJSON over `net.createConnection({path})` |
| `BridgeHost` | `connect` → Hello → `ClientHeartbeat` (15s) → `send` / `stop` (Goodbye) |

## Stdio escape hatch

Set `FAST_BRIDGE_TRANSPORT=stdio` to skip unix (tests / e2e). `BridgeHost` refuses that mode — callers keep their child-process stdio path.

## Develop

```bash
npm install
npm test
npm run build
```
