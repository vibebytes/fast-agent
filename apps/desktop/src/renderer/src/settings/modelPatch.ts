export type PatchModelRow = {
	modelId: string;
	inputModalities?: string[];
	capabilities?: string[];
	[k: string]: unknown;
};

export type ModelPatchOp = {
	op: string;
	modelId: string;
	enabled?: boolean;
	displayName?: string;
	aliases?: string[];
	supportsThinking?: boolean;
	supportedEfforts?: string[];
	defaultEffort?: string;
	inputModalities?: string[];
	capabilities?: string[];
};

export const OUTPUT_CAPABILITIES = [
	'image_generation',
	'video_generation',
	'speech',
	'transcription',
	'audio',
	'embeddings',
	'rerank',
	'decisions'
] as const;

export function addModelOp(input: {
	modelId: string;
	displayName: string;
	supportsThinking: boolean;
	supportedEfforts: string[];
	supportsImage: boolean;
	defaultEffort?: string;
	capabilities: readonly string[];
}): ModelPatchOp {
	return {
		op: 'add',
		modelId: input.modelId,
		displayName: input.displayName || input.modelId,
		supportsThinking: input.supportsThinking,
		supportedEfforts: input.supportsThinking ? input.supportedEfforts : [],
		defaultEffort: input.supportsThinking ? input.defaultEffort : undefined,
		...(input.supportsImage ? {inputModalities: ['text', 'image']} : {}),
		capabilities: orderedCapabilities(input.capabilities),
		enabled: true
	};
}

export function visibilityOp(modelId: string, enabled: boolean): ModelPatchOp {
	return {op: 'enable', modelId, enabled};
}

export function imageInputOp(modelId: string, image: boolean): ModelPatchOp {
	return {op: 'enable', modelId, inputModalities: image ? ['text', 'image'] : ['text']};
}

export function capabilityOp(
	modelId: string,
	effective: readonly string[],
	capability: string,
	on: boolean
): ModelPatchOp {
	const next = new Set(effective);
	if (on) next.add(capability);
	else next.delete(capability);
	return {op: 'enable', modelId, capabilities: orderedCapabilities([...next])};
}

export function orderedCapabilities(tags: readonly string[]): string[] {
	const present = new Set(tags);
	return OUTPUT_CAPABILITIES.filter(tag => present.has(tag));
}

export function searchAddOps(
	hits: readonly {modelId: string; displayName: string}[],
	selected: ReadonlySet<string>
): ModelPatchOp[] {
	return hits
		.filter(hit => selected.has(hit.modelId))
		.map(hit => ({op: 'add', modelId: hit.modelId, displayName: hit.displayName, enabled: true}));
}

type ProviderLike = {id: string; models?: PatchModelRow[]};

/** Optimistic model patch shared by the providers store: enable/rename/add/remove with media fields. */
export function applyModelPatch<P extends ProviderLike>(
	list: readonly P[],
	providerId: string,
	patch: readonly ModelPatchOp[]
): P[] | null {
	const idx = list.findIndex((p) => p.id === providerId);
	if (idx < 0) return null;
	const provider = list[idx]!;
	const models: PatchModelRow[] = provider.models ? [...provider.models] : [];
	let changed = false;
	for (const op of patch) {
		if (op.op === 'enable') {
			const mi = models.findIndex((m) => m.modelId === op.modelId);
			const hasPatch =
				typeof op.enabled === 'boolean' || op.inputModalities !== undefined || op.capabilities !== undefined;
			if (mi >= 0 && hasPatch) {
				const cur = models[mi]!;
				models[mi] = {
					...cur,
					...(typeof op.enabled === 'boolean' ? {enabled: op.enabled} : {}),
					...(op.inputModalities !== undefined ? {inputModalities: [...op.inputModalities]} : {}),
					...(op.capabilities !== undefined ? {capabilities: [...op.capabilities]} : {})
				};
				changed = true;
			}
		} else if (op.op === 'add') {
			const mi = models.findIndex((m) => m.modelId === op.modelId);
			if (mi < 0) {
				models.push({
					modelId: op.modelId,
					displayName: op.displayName || op.modelId,
					aliases: op.aliases ? [...op.aliases] : [],
					supportsThinking: op.supportsThinking ?? false,
					supportedEfforts: op.supportedEfforts ? [...op.supportedEfforts] : [],
					defaultEffort: op.defaultEffort,
					...(op.inputModalities !== undefined ? {inputModalities: [...op.inputModalities]} : {}),
					...(op.capabilities !== undefined ? {capabilities: [...op.capabilities]} : {}),
					enabled: op.enabled ?? true,
					source: 'manual'
				});
				changed = true;
			}
		} else if (op.op === 'remove') {
			const mi = models.findIndex((m) => m.modelId === op.modelId);
			if (mi >= 0) {
				models.splice(mi, 1);
				changed = true;
			}
		} else if (op.op === 'rename') {
			const mi = models.findIndex((m) => m.modelId === op.modelId);
			if (mi >= 0 && op.displayName) {
				models[mi] = {...models[mi]!, displayName: op.displayName};
				changed = true;
			}
		}
	}
	if (!changed) return null;
	const enabledModelCount = models.filter((m) => m.enabled).length;
	return [...list].map((p, i) =>
		i === idx ? ({...p, models, enabledModelCount, modelCount: models.length} as P) : p
	);
}
