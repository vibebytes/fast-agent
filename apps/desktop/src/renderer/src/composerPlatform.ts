/** Resolve platform + model key from a catalog entry (Composer sticky model_settings). */
export function platformModel(entry: {
	id: string;
	display: string;
}): {platform: string; model: string} {
	const slash = entry.display.indexOf('/');
	const platform =
		slash > 0 ? entry.display.slice(0, slash) : entry.id.split('/')[0] ?? 'openrouter';
	const catalogModel = entry.id.includes('/')
		? entry.id.split('/').slice(1).join('/')
		: slash > 0
			? entry.display.slice(slash + 1)
			: (entry.id.split('/').pop() ?? entry.id);
	return {platform, model: catalogModel || entry.id};
}
