# `modules/engine`

`current/` is gitignored. Only `pnpm fetch-engine` writes it (Maven Central `ai.fastllm` 0.3.0 → `current/bin/fast-cli`, alias `fast`). JDK + Maven. Incremental by default; refresh or change OS:

```bash
pnpm fetch-engine -- --clean
```
