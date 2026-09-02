# `modules/engine`

`current/` is gitignored. Only `pnpm fetch-engine` writes it (Maven Central `ai.fastllm` 0.3.0 → `current/bin/fast-cli`, alias `fast`). Pack/fetch needs JDK + Maven; the tree also gets a Temurin 17 JRE at `current/jre/` and `bin/fast-cli` execs that `java`. Incremental by default; refresh or change OS:

```bash
pnpm fetch-engine -- --clean
```

Dev escape if you must use a system JDK: `FAST_USE_SYSTEM_JAVA=1`. Packaged trees must keep `jre/`.
