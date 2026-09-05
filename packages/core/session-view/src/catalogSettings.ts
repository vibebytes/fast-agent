import {
	concreteModelDisplay,
	isPlaceholderModelDisplay,
	isUnresolvedModelDisplay,
	wireUseModel
} from './defaultModel.js';
import {matchCatalogEntry} from './modelMatch.js';
import {parseEngineKind} from './taskLifecycle.js';
import type {EngineKind} from './taskLifecycle.js';
import type {ModelCatalogEntry} from './wire.js';

export type RunMode = 'agent' | 'plan' | 'ask' | 'yolo';
export type {EngineKind};

export type CatalogSettingsTaskLike = {
	id: string;
	model: string;
	modelDisplay: string;
	runMode: RunMode;
	engineKind: EngineKind;
	effort?: string;
	thinking?: boolean;
};

export type CatalogSettingsDeps<T extends CatalogSettingsTaskLike> = {
	getActiveTask: () => T | null;
	tasks: Map<string, T>;
	onChange?: () => void;
};

export function parseRunMode(raw?: string | null): RunMode {
	const m = (raw ?? '').trim().toLowerCase();
	if (m === 'plan' || m === 'ask' || m === 'yolo' || m === 'agent') return m;
	return 'agent';
}

/** First catalog row that matches a chrome id / display / alias. */
export function catalogEntryFor(
	entries: ModelCatalogEntry[],
	ref: string | undefined
): ModelCatalogEntry | undefined {
	const t = (ref ?? '').trim();
	if (!t) return undefined;
	return entries.find(e => matchCatalogEntry(e, t));
}

/**
 * Composer selected chrome must be a ListProviders row.
 * Keep the current pick when it is in the catalog; otherwise Settings-current or first enabled.
 */
export function resolveComposerChrome(
	entries: ModelCatalogEntry[],
	model: string,
	display: string
): ModelCatalogEntry | undefined {
	return (
		catalogEntryFor(entries, model) ??
		catalogEntryFor(entries, display) ??
		entries.find(e => e.current) ??
		entries[0]
	);
}

/**
 * Sticky Composer chrome: selected model + catalog state + run mode / engine /
 * sampling. Mirrors writes into the active TaskRecord so chrome survives tab
 * switches; engine `/model` list handling defers to the provider catalog once
 * it has been hydrated from Settings.
 */
export function createCatalogSettings<T extends CatalogSettingsTaskLike>(
	deps: CatalogSettingsDeps<T>
) {
	let model = 'default';
	let modelDisplay = '';
	let modelCatalog: ModelCatalogEntry[] = [];
	let runMode: RunMode = 'agent';
	let engineKind: EngineKind = 'fast';
	let effort: string | undefined;
	let thinking: boolean | undefined;
	let catalogFromProviders = false;
	let awaitingModelList = false;

	const catalogHas = (ref: string): boolean => {
		const t = ref.trim();
		if (!t) return false;
		return modelCatalog.some(e => matchCatalogEntry(e, t));
	};

	const applyModel = (nextModel: string, nextDisplay: string): void => {
		let resolved = concreteModelDisplay(nextModel, nextDisplay);
		if (!resolved) {
			const raw = nextDisplay.trim() || nextModel.trim();
			if (catalogHas(raw) || catalogHas(nextModel)) resolved = raw;
		}
		if (!resolved) {
			if (!isUnresolvedModelDisplay(modelDisplay)) return;
			model = 'default';
			modelDisplay = '';
			const active = deps.getActiveTask();
			if (active && isUnresolvedModelDisplay(active.modelDisplay)) {
				active.model = 'default';
				active.modelDisplay = '';
				deps.tasks.set(active.id, active);
			}
			return;
		}
		const key = wireUseModel(nextModel, resolved) ?? (catalogHas(resolved) ? resolved : nextModel);
		model = key;
		modelDisplay = resolved;
		const active = deps.getActiveTask();
		if (active) {
			active.model = key;
			active.modelDisplay = resolved;
			deps.tasks.set(active.id, active);
		}
		if (!isUnresolvedModelDisplay(resolved)) {
			for (const t of deps.tasks.values()) {
				if (t.id === active?.id) continue;
				if (!isUnresolvedModelDisplay(t.modelDisplay)) continue;
				const sameKey =
					t.model === nextModel ||
					t.model === key ||
					(isPlaceholderModelDisplay(t.model) && isPlaceholderModelDisplay(nextModel));
				if (!sameKey) continue;
				t.model = key;
				t.modelDisplay = resolved;
				deps.tasks.set(t.id, t);
			}
		}
	};

	const applyRunMode = (mode: RunMode): void => {
		runMode = mode;
		const task = deps.getActiveTask();
		if (!task) return;
		task.runMode = mode;
		deps.tasks.set(task.id, task);
	};

	const applyEngineKind = (kind: EngineKind): void => {
		engineKind = kind;
		const task = deps.getActiveTask();
		if (!task) return;
		task.engineKind = kind;
		deps.tasks.set(task.id, task);
	};

	const applySampling = (nextEffort?: string, nextThinking?: boolean): void => {
		if (nextEffort !== undefined) effort = nextEffort || undefined;
		if (nextThinking !== undefined) thinking = nextThinking;
		const task = deps.getActiveTask();
		if (!task) return;
		if (nextEffort !== undefined) {
			if (nextEffort) task.effort = nextEffort;
			else delete task.effort;
		}
		if (nextThinking !== undefined) task.thinking = nextThinking;
		deps.tasks.set(task.id, task);
	};

	/** Composer chrome: supportsThinking models default thinking On when sticky unset. */
	const submitThinking = (): boolean | undefined => {
		if (thinking !== undefined) return thinking;
		const entry = modelCatalog.find(e => matchCatalogEntry(e, model));
		if (entry?.supportsThinking) return true;
		return undefined;
	};

	/**
	 * Paint the Composer with a resolved default-model label (never the bare `default`
	 * alias or the yaml nemotron stub). Used when Hello still carries the alias stub
	 * but Settings/Providers know the real id.
	 */
	const healDefaultModelDisplay = (nextModel: string, display: string): boolean => {
		if (isPlaceholderModelDisplay(display)) return false;
		if (isUnresolvedModelDisplay(display) && !catalogHas(display) && !catalogHas(nextModel)) {
			return false;
		}
		const currentUnresolved =
			isUnresolvedModelDisplay(modelDisplay) || isPlaceholderModelDisplay(model);
		const notInCatalog = modelCatalog.length > 0 && !catalogHas(model) && !catalogHas(modelDisplay);
		if (!currentUnresolved && !notInCatalog && modelDisplay !== display) return false;
		applyModel(nextModel, display);
		deps.onChange?.();
		return true;
	};

	/** Provider catalog (Settings enabled models) replaces the engine dump catalog. */
	const applyProviderCatalog = (entries: ModelCatalogEntry[]): void => {
		catalogFromProviders = true;
		awaitingModelList = false;
		const pick = resolveComposerChrome(entries, model, modelDisplay);
		modelCatalog = entries.map(e => ({
			...e,
			current: pick ? matchCatalogEntry(e, pick.id) || matchCatalogEntry(e, pick.display) : false
		}));
		if (pick && (model !== pick.id || modelDisplay !== pick.display)) {
			applyModel(pick.id, pick.display);
		}
		deps.onChange?.();
	};

	/** Engine `/model` dump arrived; adopt rows + return the current row to apply. */
	const takeEngineModelList = (entries: ModelCatalogEntry[]): ModelCatalogEntry | undefined => {
		awaitingModelList = false;
		modelCatalog = entries;
		return entries.find(e => e.current);
	};

	/** Silent `/model` refresh (Tab open / catalog heal) unless Settings already owns the list. */
	const requestModelList = (
		sessionId: string | undefined,
		send: (sessionId: string) => boolean
	): boolean => {
		if (catalogFromProviders) return true;
		if (!sessionId) return false;
		awaitingModelList = true;
		return send(sessionId);
	};

	const selectModel = (modelId: string): {resolvedId: string; resolvedDisplay: string} | null => {
		const id = modelId.trim();
		if (!id) return null;
		const entry = modelCatalog.find(e => matchCatalogEntry(e, id));
		const resolvedId = entry?.id ?? id;
		const resolvedDisplay =
			entry?.display ?? (id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id);
		applyModel(resolvedId, resolvedDisplay);
		modelCatalog = modelCatalog.map(e => ({
			...e,
			current: matchCatalogEntry(e, resolvedId) || matchCatalogEntry(e, resolvedDisplay)
		}));
		return {resolvedId, resolvedDisplay};
	};

	/** Open Tab / Attach reconcile: adopt the Task's sticky chrome, backfilling its display. */
	const syncFromTask = (task: T): void => {
		const sameKey =
			task.model === model ||
			(isPlaceholderModelDisplay(task.model) && isPlaceholderModelDisplay(model));
		if (
			sameKey &&
			isUnresolvedModelDisplay(task.modelDisplay) &&
			!isUnresolvedModelDisplay(modelDisplay)
		) {
			task.modelDisplay = modelDisplay;
			if (isPlaceholderModelDisplay(task.model)) task.model = model;
			deps.tasks.set(task.id, task);
		}
		model = task.model;
		modelDisplay = task.modelDisplay;
		runMode = task.runMode ?? 'agent';
		engineKind = task.engineKind ?? 'fast';
		effort = task.effort;
		thinking = task.thinking;
	};

	/** Engine sticky push onto a Task row (omit effort/thinking → keep prior chrome). */
	const applyStickyChrome = (
		task: T,
		info: {runMode?: string; engineKind?: string | null; modelSettings?: {
			platform: string;
			model: string;
			effort?: string;
			thinking?: boolean;
		} | null}
	): void => {
		if (info.runMode != null && info.runMode !== '') task.runMode = parseRunMode(info.runMode);
		if (info.engineKind != null && info.engineKind !== '') {
			task.engineKind = parseEngineKind(info.engineKind);
		}
		const ms = info.modelSettings;
		if (!ms) return;
		task.model = `${ms.platform}/${ms.model}`;
		// Match Engine catalog / LLMModelLookup.displayName shape (platform/model), not bare alias.
		task.modelDisplay = `${ms.platform}/${ms.model}`;
		if (ms.effort) task.effort = ms.effort;
		if (ms.thinking !== undefined) task.thinking = ms.thinking;
	};

	const reset = (): void => {
		model = 'default';
		modelDisplay = '';
		resetCatalog();
		runMode = 'agent';
		engineKind = 'fast';
		effort = undefined;
		thinking = undefined;
	};

	const resetCatalog = (): void => {
		modelCatalog = [];
		catalogFromProviders = false;
		awaitingModelList = false;
	};

	return {
		applyModel,
		applyRunMode,
		applyEngineKind,
		applySampling,
		submitThinking,
		catalogHas,
		healDefaultModelDisplay,
		takeEngineModelList,
		applyProviderCatalog,
		requestModelList,
		selectModel,
		syncFromTask,
		applyStickyChrome,
		reset,
		resetCatalog,
		clearAwaitingModelList: () => {
			awaitingModelList = false;
		},
		get catalogFromProviders() {
			return catalogFromProviders;
		},
		get awaitingModelList() {
			return awaitingModelList;
		},
		get model() {
			return model;
		},
		get modelDisplay() {
			return modelDisplay;
		},
		get modelCatalog() {
			return modelCatalog;
		},
		get runMode() {
			return runMode;
		},
		get engineKind() {
			return engineKind;
		},
		get effort() {
			return effort;
		},
		get thinking() {
			return thinking;
		}
	};
}
