export type ModelVisibilityFilter = 'enabled' | 'hidden' | 'all';

type ProviderWithModels = {
	id: string;
	models?: Array<{
		modelId: string;
		displayName: string;
		enabled: boolean;
	}>;
};

export function filterModelProviders<P extends ProviderWithModels>(
	providers: readonly P[],
	filter: ModelVisibilityFilter,
	providerFilter: string,
	query: string
): P[] {
	const q = query.trim().toLowerCase();
	return providers
		.filter(p => providerFilter === 'all' || p.id === providerFilter)
		.map(p => {
			const originalModels = p.models ?? [];
			const models = originalModels.filter(m => {
				if (filter === 'enabled' && !m.enabled) return false;
				if (filter === 'hidden' && m.enabled) return false;
				if (!q) return true;
				return m.displayName.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q);
			});
			return {provider: p, originalCount: originalModels.length, models};
		})
		.filter(({provider: p, originalCount, models}) =>
			providerFilter === p.id || models.length > 0 || (!q && originalCount === 0)
		)
		.map(({provider: p, models}) => ({...p, models}));
}
