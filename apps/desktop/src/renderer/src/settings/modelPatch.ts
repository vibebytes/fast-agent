export type PatchModelRow = {
	modelId: string;
	inputModalities?: string[];
	capabilities?: string[];
	free?: boolean;
	contextWindow?: number;
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
	free?: boolean;
	contextWindow?: number;
};

/** Parses `128000`, `128k`, `1m` / `1.5M` into tokens; `''` → `0` (clear); anything else → `null`. */
export function parseContextWindow(raw: string): number | null {
	const s = raw.trim().toLowerCase().replace(/[,_\s]/g, '');
	if (s === '') return 0;
	const m = /^(\d+(?:\.\d+)?)([km]?)$/.exec(s);
	if (!m) return null;
	const scale = m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1;
	const tokens = Math.round(Number(m[1]) * scale);
	return tokens > 0 ? tokens : null;
}

/** Compact label: 128000 → `128k`, 1048576 → `1M`. */
export function formatContextWindow(tokens: number): string {
	if (tokens >= 1_000_000) {
		const unit = tokens % 1_048_576 === 0 ? 1_048_576 : 1_000_000;
		return `${+(tokens / unit).toFixed(1)}M`;
	}
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
	return String(tokens);
}

export function contextWindowOp(modelId: string, tokens: number): ModelPatchOp {
	return {op: 'enable', modelId, contextWindow: tokens};
}

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
	contextWindow?: number;
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
		...(input.contextWindow && input.contextWindow > 0 ? {contextWindow: input.contextWindow} : {}),
		enabled: true
	};
}

export function visibilityOp(modelId: string, enabled: boolean): ModelPatchOp {
	return {op: 'enable', modelId, enabled};
}

export function addModelOps(input: {
	modelId: string;
	displayName: string;
	supportsThinking: boolean;
	supportedEfforts: string[];
	supportsImage: boolean;
	defaultEffort?: string;
	capabilities: readonly string[];
	free?: boolean;
	contextWindow?: number;
}): ModelPatchOp[] {
	const add = addModelOp(input);
	return input.free === true ? [add, freeOp(input.modelId, true)] : [add];
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

export function freeOp(modelId: string, free: boolean): ModelPatchOp {
	return {op: 'setFree', modelId, free};
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
				typeof op.enabled === 'boolean' ||
				op.inputModalities !== undefined ||
				op.capabilities !== undefined ||
				op.contextWindow !== undefined;
			if (mi >= 0 && hasPatch) {
				const cur = models[mi]!;
				const next: PatchModelRow = {
					...cur,
					...(typeof op.enabled === 'boolean' ? {enabled: op.enabled} : {}),
					...(op.inputModalities !== undefined ? {inputModalities: [...op.inputModalities]} : {}),
					...(op.capabilities !== undefined ? {capabilities: [...op.capabilities]} : {})
				};
				if (op.contextWindow !== undefined) {
					if (op.contextWindow > 0) next.contextWindow = op.contextWindow;
					else delete next.contextWindow;
				}
				models[mi] = next;
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
					...(op.contextWindow && op.contextWindow > 0 ? {contextWindow: op.contextWindow} : {}),
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
		} else if (op.op === 'setFree') {
			const mi = models.findIndex((m) => m.modelId === op.modelId);
			if (mi >= 0) {
				models[mi] = {
					...models[mi]!,
					...(typeof op.free === 'boolean' ? {free: op.free} : {}),
					freeLocked: true
				};
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
