/**
 * Legacy models.yaml `default` alias (`openrouter` / nemotron-free).
 * Detect-only: Composer chrome must not paint this unless it is in the DB catalog.
 */
export const DefaultModelDisplay = 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free';

export function isPlaceholderModelDisplay(display: string | undefined): boolean {
	const t = (display ?? '').trim().toLowerCase();
	return !t || t === 'default';
}

/** Yaml `default` alias label — not a Settings/DB row. */
export function isYamlDefaultStub(display: string | undefined): boolean {
	return (display ?? '').trim().toLowerCase() === DefaultModelDisplay.toLowerCase();
}

/** Empty / `default` alias / yaml stub — wait for ListProviders before painting. */
export function isUnresolvedModelDisplay(display: string | undefined): boolean {
	return isPlaceholderModelDisplay(display) || isYamlDefaultStub(display);
}

/** Resolve alias stub → concrete catalog name. Never invent the yaml nemotron id. */
export function concreteModelDisplay(model: string, modelDisplay?: string): string {
	const display = (modelDisplay ?? '').trim() || model.trim();
	if (!isUnresolvedModelDisplay(display)) return display;
	if (!isUnresolvedModelDisplay(model)) return model.trim();
	return '';
}

/**
 * Catalog key for Submit `useModel`. The Engine looks this up in the live registry
 * and throws if it is the alias stub `default` (often dropped after a DB overlay).
 */
export function wireUseModel(model: string, modelDisplay?: string): string | undefined {
	const m = model.trim();
	const d = (modelDisplay ?? '').trim();
	if (!isUnresolvedModelDisplay(m)) return m;
	if (!isUnresolvedModelDisplay(d)) return d;
	return undefined;
}

/**
 * Compact Composer chip label. Long `platform/vendor/model` strings were flex-shrunk
 * to zero width (only the chevron remained) — keep a short, visible model id.
 */
export function composerModelLabel(model: string, modelDisplay?: string): string {
	const full = concreteModelDisplay(model, modelDisplay);
	const slash = full.lastIndexOf('/');
	return slash >= 0 ? full.slice(slash + 1) : full;
}
