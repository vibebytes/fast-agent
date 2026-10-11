# `modules/engine`

`current/` is gitignored. Only `pnpm fetch-engine` writes it (Maven Central `ai.fastllm` 0.3.0 → `current/bin/fast-cli`, alias `fast`). Pack/fetch needs JDK + Maven; the tree also gets a Temurin 17 JRE at `current/jre/` and `bin/fast-cli` execs that `java`. Flags go after `--`. Default is `--incremental` (skip Maven when `current/bin/fast-cli` exists; still ensures the JRE). It does not check the OS already in `current/`. Refresh or change OS with `--clean`; target OS is `--os` or a positional `darwin-arm64` / `darwin-x64` / `linux-x64` / `linux-arm64` / `win32-x64` / `all`:

```bash
pnpm fetch-engine -- --clean
pnpm fetch-engine -- --os darwin-arm64
```

Dev escape if you must use a system JDK: `FAST_USE_SYSTEM_JAVA=1`. Packaged trees must keep `jre/`.

`pnpm pack` stamps `engine/.fast-engine-id` as `<agent.version> <jre-mark> <UTC ISO>` (new timestamp each stage). The launcher exports it as `FAST_ENGINE_ID` so `HelloOk.engineId` can match the pack.
