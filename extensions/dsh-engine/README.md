# `fast-engine-dsh`

DSH `Engine` (Host `/api`). Scala package `ai.fastllm.agent.dsh`. Artifact `fast-engine-dsh`.

Depends on `agent-engine-api` (provided) only. Loaded by YAML + `META-INF/services`.

DSH itself needs **Node.js `^22.19 || >=24`**. `npx` / spawn inherit the JVM `PATH`.

| Env / YAML `config` | Effect |
|---|---|
| `FAST_DSH_PORT` / `config.port` | Attach to `http://127.0.0.1:<port>` (no spawn) |
| `FAST_DSH_COMMAND` / `config.command` | Spawn (`npx --yes @deepseek-ai/dsh web --host 127.0.0.1 --port 0`) |
| both missing | attach official **3080** (`npx @deepseek-ai/dsh web`) |

Enable in `conf/engines.yaml` (`id: dsh`, `enabled: true`). No YAML → Fast only; no sidecar.
