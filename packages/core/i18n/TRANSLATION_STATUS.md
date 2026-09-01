# Translation status (ship gate)

Source of truth: `locales/en.json` (536 keys).  
Parity: `pnpm check:i18n` (presence, non-empty, placeholder parity).

| Locale | Status | Notes |
|--------|--------|-------|
| `en` | done | Source of truth |
| `zh-CN` | done | Full Simplified Chinese |
| `ja` | done | P1 |
| `pt-BR` | done | P1 |
| `es` | done | P1 |
| `de` | done | P1 |
| `zh-TW` | done | P2 — Traditional Chinese (Taiwan), from zh-CN via OpenCC `s2twp` + review |
| `fr` | done | P2 |
| `ko` | done | P2 |
| `ru` | done | P2 |

## Sign-off

- [x] Every key present, non-empty, placeholder-parity (`pnpm check:i18n`)
- [x] Non-`en` locales are real translations (not English clones); remaining identical strings are product/universal terms (`Git`, `Shell`, `Goal`, `Subagent`, `Diff`, …)
- [x] Placeholders preserved exactly (`{{detail}}`, `{{seconds}}`, …)
- [x] Workflow complete: zh-CN → P1 → P2

Last verified: 2026-08-04
