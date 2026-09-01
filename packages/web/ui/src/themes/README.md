# Palette/UI themes

Vendored from [Palette/UI](https://www.paletteui.xyz/) (shadcn/ui OKLCH tokens).

- `palette/*.json` — raw theme items (66 vendored from Palette/UI + 1 homegrown `fast`)
- `catalog.ts` — generated TypeScript catalog (swatches + categories)
- `applyPalette.ts` — writes CSS variables onto `:root`; light mode derives a slightly sunk `--sidebar` from `--background` when palette omits sidebar (dark unchanged)

Regenerate catalog after updating JSON files:

```bash
node packages/ui/src/themes/generate-catalog.mjs
```
