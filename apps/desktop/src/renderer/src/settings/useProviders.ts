import {useEffect, useSyncExternalStore} from 'react';
import type {
	ProviderModel,
	ProviderModelPatch,
	ProviderRow,
	SearchModelRow,
	UpsertProviderInput
} from '@fast-ide/session-view';

export type ProvidersStatus = 'loading' | 'ready' | 'error' | 'disabled';

export type Provider = ProviderRow;
export type SeedModel = ProviderModel;
export type UpsertInput = UpsertProviderInput;
export type ModelPatch = ProviderModelPatch;
export type SearchModel = SearchModelRow;

export type ProvidersView = {
	status: ProvidersStatus;
	providers: Provider[];
	notice: string | null;
	engineReady: boolean;
};

type ProvidersApi = {
	listProviders: () => Promise<{ok: true; providers: Provider[]} | {ok: false; notice: string}>;
	upsertProvider: (
		input: UpsertInput
	) => Promise<{ok: true; provider: Provider} | {ok: false; notice: string}>;
	deleteProvider: (id: string) => Promise<{ok: true} | {ok: false; notice: string}>;
	setProviderEnabled: (
		id: string,
		enabled: boolean
	) => Promise<{ok: true; provider: Provider} | {ok: false; notice: string}>;
	testProvider: (
		id: string
	) => Promise<{ok: true; provider: Provider} | {ok: false; notice: string}>;
	patchProviderModels: (
		id: string,
		patch: ModelPatch[]
	) => Promise<{ok: true; provider: Provider} | {ok: false; notice: string}>;
	searchProviderModels: (
		id: string,
		query: string
	) => Promise<{ok: true; searchModels: SearchModel[]} | {ok: false; notice: string}>;
	onProvidersChanged?: (handler: (payload: {providerId: string}) => void) => () => void;
};

function viewOf(
	providers: Provider[],
	status: ProvidersStatus,
	notice: string | null,
	engineReady: boolean
): ProvidersView {
	return {status, providers, notice, engineReady};
}

function liveApi(): ProvidersApi {
	return {
		listProviders: () => window.fastIde.listProviders(),
		upsertProvider: input => window.fastIde.upsertProvider(input),
		deleteProvider: id => window.fastIde.deleteProvider(id),
		setProviderEnabled: (id, enabled) => window.fastIde.setProviderEnabled(id, enabled),
		testProvider: id => window.fastIde.testProvider(id),
		patchProviderModels: (id, patch) => window.fastIde.patchProviderModels(id, patch),
		searchProviderModels: (id, query) => window.fastIde.searchProviderModels(id, query),
		onProvidersChanged: handler => window.fastIde.onProvidersChanged(handler)
	};
}

function upsertLocal(list: Provider[], provider: Provider): Provider[] {
	const idx = list.findIndex(p => p.id === provider.id);
	if (idx < 0) return [...list, provider];
	const next = [...list];
	next[idx] = provider;
	return next;
}

function removeLocal(list: Provider[], id: string): Provider[] {
	return list.filter(p => p.id !== id);
}

/** Optimistic model updates so Switches and additions stay put without waiting on IPC. */
function applyModelPatchLocal(
	list: Provider[],
	providerId: string,
	patch: ModelPatch[]
): Provider[] | null {
	const idx = list.findIndex(p => p.id === providerId);
	if (idx < 0) return null;
	const provider = list[idx]!;
	const models = provider.models ? [...provider.models] : [];
	let changed = false;
	for (const op of patch) {
		if (op.op === 'enable' && typeof op.enabled === 'boolean') {
			const mi = models.findIndex(m => m.modelId === op.modelId);
			if (mi >= 0) {
				models[mi] = {...models[mi]!, enabled: op.enabled};
				changed = true;
			}
		} else if (op.op === 'add') {
			const mi = models.findIndex(m => m.modelId === op.modelId);
			if (mi < 0) {
				models.push({
					modelId: op.modelId,
					displayName: op.displayName || op.modelId,
					aliases: op.aliases ?? [],
					supportsThinking: op.supportsThinking ?? false,
					supportedEfforts: op.supportedEfforts ?? [],
					defaultEffort: op.defaultEffort,
					enabled: op.enabled ?? true,
					source: 'manual'
				});
				changed = true;
			}
		} else if (op.op === 'remove') {
			const mi = models.findIndex(m => m.modelId === op.modelId);
			if (mi >= 0) {
				models.splice(mi, 1);
				changed = true;
			}
		} else if (op.op === 'rename') {
			const mi = models.findIndex(m => m.modelId === op.modelId);
			if (mi >= 0 && op.displayName) {
				models[mi] = {...models[mi]!, displayName: op.displayName};
				changed = true;
			}
		}
	}
	if (!changed) return null;
	const enabledModelCount = models.filter(m => m.enabled).length;
	const next = [...list];
	next[idx] = {
		...provider,
		models,
		enabledModelCount,
		modelCount: models.length
	};
	return next;
}

class ProvidersStore {
	private view: ProvidersView = viewOf([], 'loading', null, false);
	private listeners = new Set<() => void>();
	private inflight: Promise<void> | null = null;
	private generation = 0;
	private api: ProvidersApi = liveApi();

	/** Test seam — swap IPC for an in-memory double. */
	bindApi(api: ProvidersApi): void {
		this.api = api;
	}

	/** Test seam — clear cached view between cases. */
	resetForTest(): void {
		this.generation += 1;
		this.inflight = null;
		this.view = viewOf([], 'loading', null, false);
		this.publish();
	}

	getSnapshot = (): ProvidersView => this.view;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	private publish(): void {
		for (const listener of this.listeners) listener();
	}

	private setView(next: ProvidersView): void {
		this.view = next;
		this.publish();
	}

	setEngineReady(ready: boolean): void {
		if (this.view.engineReady === ready) return;
		if (!ready) {
			this.setView({...this.view, engineReady: false, status: 'disabled', notice: null});
			return;
		}
		this.setView({...this.view, engineReady: true});
		void this.list();
	}

	list = async (opts?: {quiet?: boolean}): Promise<void> => {
		if (!this.view.engineReady) {
			this.setView({...this.view, status: 'disabled', notice: null});
			return;
		}
		const gen = ++this.generation;
		// PatchModels fans out providers_changed — keep Models UI mounted (no loading flash).
		const quiet = opts?.quiet === true && this.view.status === 'ready';
		if (!quiet) {
			this.setView({...this.view, status: 'loading', notice: null});
		}
		const run = this.api.listProviders().then(res => {
			if (gen !== this.generation) return;
			if (!res.ok) {
				this.setView(viewOf(this.view.providers, quiet ? 'ready' : 'error', res.notice, true));
				return;
			}
			this.setView(viewOf(res.providers, 'ready', null, true));
		});
		this.inflight = run.finally(() => {
			if (this.inflight === run) this.inflight = null;
		});
		await this.inflight;
	};

	retry = (): void => {
		void this.list();
	};

	invalidate = (): void => {
		if (!this.view.engineReady) return;
		void this.list({quiet: true});
	};

	upsert = async (input: UpsertInput): Promise<Provider | null> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return null;
		const prev = this.view;
		const res = await this.api.upsertProvider(input);
		if (!res.ok) {
			this.setView({...prev, notice: res.notice, status: 'ready'});
			return null;
		}
		this.setView(viewOf(upsertLocal(this.view.providers, res.provider), 'ready', null, true));
		return res.provider;
	};

	remove = async (id: string): Promise<boolean> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return false;
		const prev = this.view;
		this.setView(viewOf(removeLocal(prev.providers, id), 'ready', null, true));
		const res = await this.api.deleteProvider(id);
		if (!res.ok) {
			this.setView({...prev, notice: res.notice, status: 'ready'});
			return false;
		}
		return true;
	};

	setEnabled = async (id: string, enabled: boolean): Promise<boolean> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return false;
		const prev = this.view;
		const optimistic = prev.providers.map(p => (p.id === id ? {...p, enabled} : p));
		this.setView(viewOf(optimistic, 'ready', null, true));
		const res = await this.api.setProviderEnabled(id, enabled);
		if (!res.ok) {
			this.setView({...prev, notice: res.notice, status: 'ready'});
			return false;
		}
		this.setView(viewOf(upsertLocal(this.view.providers, res.provider), 'ready', null, true));
		return true;
	};

	test = async (id: string): Promise<boolean> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return false;
		const prev = this.view;
		const res = await this.api.testProvider(id);
		if (!res.ok) {
			this.setView({...prev, notice: res.notice, status: 'ready'});
			return false;
		}
		this.setView(viewOf(upsertLocal(this.view.providers, res.provider), 'ready', null, true));
		return true;
	};

	patchModels = async (id: string, patch: ModelPatch[]): Promise<boolean> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return false;
		const prev = this.view;
		const optimistic = applyModelPatchLocal(prev.providers, id, patch);
		if (optimistic) {
			this.setView(viewOf(optimistic, 'ready', null, true));
		}
		const res = await this.api.patchProviderModels(id, patch);
		if (!res.ok) {
			this.setView({...prev, notice: res.notice, status: 'ready'});
			return false;
		}
		this.setView(viewOf(upsertLocal(this.view.providers, res.provider), 'ready', null, true));
		return true;
	};

	searchModels = async (
		id: string,
		query: string
	): Promise<{ok: true; models: SearchModel[]} | {ok: false; notice: string}> => {
		if (!this.view.engineReady || this.view.status === 'disabled') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const res = await this.api.searchProviderModels(id, query);
		if (!res.ok) {
			this.setView({...this.view, notice: res.notice, status: 'ready'});
			return {ok: false, notice: res.notice};
		}
		return {ok: true, models: res.searchModels};
	};
}

export const providersStore = new ProvidersStore();

let pushBound = false;

function ensurePush(): void {
	if (pushBound) return;
	pushBound = true;
	const api = liveApi();
	api.onProvidersChanged?.(() => {
		providersStore.invalidate();
	});
}

/** Model providers (Engine Meta) — Providers / Models P0.5. */
export function useProviders(engineReady: boolean): ProvidersView & {
	retry: () => void;
	list: () => Promise<void>;
	upsert: (input: UpsertInput) => Promise<Provider | null>;
	remove: (id: string) => Promise<boolean>;
	setEnabled: (id: string, enabled: boolean) => Promise<boolean>;
	test: (id: string) => Promise<boolean>;
	patchModels: (id: string, patch: ModelPatch[]) => Promise<boolean>;
	searchModels: (
		id: string,
		query: string
	) => Promise<{ok: true; models: SearchModel[]} | {ok: false; notice: string}>;
} {
	useEffect(() => {
		ensurePush();
		providersStore.setEngineReady(engineReady);
	}, [engineReady]);

	const view = useSyncExternalStore(
		providersStore.subscribe,
		providersStore.getSnapshot,
		providersStore.getSnapshot
	);

	return {
		...view,
		retry: providersStore.retry,
		list: providersStore.list,
		upsert: providersStore.upsert,
		remove: providersStore.remove,
		setEnabled: providersStore.setEnabled,
		test: providersStore.test,
		patchModels: providersStore.patchModels,
		searchModels: providersStore.searchModels
	};
}
