import {useEffect, useSyncExternalStore} from 'react';
import type {
	ProviderModel,
	ProviderModelPatch,
	ProviderLoginPrompt,
	ProviderRow,
	SearchModelRow,
	UpsertProviderInput
} from '@fast-ide/session-view';
import {applyModelPatch} from './modelPatch';

export type ProvidersStatus = 'loading' | 'ready' | 'error' | 'disabled';

export type Provider = ProviderRow;
export type SeedModel = ProviderModel;
export type UpsertInput = UpsertProviderInput;
export type ModelPatch = ProviderModelPatch;
export type SearchModel = SearchModelRow;
export type LoginPrompt = ProviderLoginPrompt;

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
	startProviderLogin: (
		id: string
	) => Promise<{ok: true; login: LoginPrompt} | {ok: false; notice: string}>;
	finishProviderLogin: (
		id: string,
		login: LoginPrompt
	) => Promise<{ok: true; provider: Provider} | {ok: false; notice: string}>;
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
		startProviderLogin: id => window.fastIde.startProviderLogin(id),
		finishProviderLogin: (id, login) => window.fastIde.finishProviderLogin(id, login),
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

type PendingModelPatch = {
	patch: ModelPatch[];
	resolve: (ok: boolean) => void;
};

class ProvidersStore {
	private view: ProvidersView = viewOf([], 'loading', null, false);
	private listeners = new Set<() => void>();
	private inflight: Promise<void> | null = null;
	private generation = 0;
	private mutationVersion = 0;
	private modelQueues = new Map<string, PendingModelPatch[]>();
	private confirmedModels = new Map<string, Provider>();
	private refreshPending = false;
	private api: ProvidersApi = liveApi();

	/** Test seam — swap IPC for an in-memory double. */
	bindApi(api: ProvidersApi): void {
		this.api = api;
	}

	/** Test seam — clear cached view between cases. */
	resetForTest(): void {
		this.generation += 1;
		this.mutationVersion += 1;
		this.inflight = null;
		this.modelQueues.clear();
		this.confirmedModels.clear();
		this.refreshPending = false;
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
		const version = this.mutationVersion;
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
			if (version !== this.mutationVersion) {
				this.refreshPending = true;
				return;
			}
			let next = res.providers;
			if (this.modelQueues.size > 0) {
				this.refreshPending = true;
				for (const id of this.modelQueues.keys()) {
					const current = this.view.providers.find(p => p.id === id);
					if (current) next = upsertLocal(next, current);
				}
			}
			this.setView(viewOf(next, 'ready', null, true));
		});
		this.inflight = run;
		try {
			await run;
		} finally {
			if (this.inflight === run) this.inflight = null;
			this.flushRefresh();
		}
	};

	retry = (): void => {
		void this.list();
	};

	invalidate = (): void => {
		if (!this.view.engineReady) return;
		this.refreshPending = true;
		this.flushRefresh();
	};

	private flushRefresh(): void {
		if (
			!this.refreshPending ||
			!this.view.engineReady ||
			this.modelQueues.size > 0 ||
			this.inflight
		) return;
		this.refreshPending = false;
		void this.list({quiet: true});
	}

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

	patchModels = (id: string, patch: ModelPatch[]): Promise<boolean> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return Promise.resolve(false);
		return new Promise(resolve => {
			const queue = this.modelQueues.get(id) ?? [];
			if (queue.length === 0) {
				const confirmed = this.view.providers.find(p => p.id === id);
				if (confirmed) this.confirmedModels.set(id, confirmed);
			}
			const next = [...queue, {patch, resolve}];
			this.modelQueues.set(id, next);
			this.mutationVersion += 1;
			const optimistic = applyModelPatch(this.view.providers, id, patch);
			if (optimistic) {
				this.setView(viewOf(optimistic, 'ready', null, true));
			}
			if (next.length === 1) void this.runModelPatch(id);
		});
	};

	private async runModelPatch(id: string): Promise<void> {
		const mutation = this.modelQueues.get(id)?.[0];
		if (!mutation) return;
		const res = await this.api.patchProviderModels(id, mutation.patch).catch(error => ({
			ok: false as const,
			notice: error instanceof Error ? error.message : String(error)
		}));
		const queue = this.modelQueues.get(id);
		if (queue?.[0] !== mutation) return;
		queue.shift();
		if (res.ok) this.confirmedModels.set(id, res.provider);

		const confirmed = this.confirmedModels.get(id);
		let providers = this.view.providers;
		if (confirmed) {
			providers = upsertLocal(providers, confirmed);
			const remaining = queue.flatMap(item => item.patch);
			if (remaining.length > 0) {
				providers = applyModelPatch(providers, id, remaining) ?? providers;
			}
		}
		this.setView(viewOf(providers, 'ready', res.ok ? this.view.notice : res.notice, true));
		mutation.resolve(res.ok);

		if (queue.length > 0) {
			void this.runModelPatch(id);
		} else {
			this.modelQueues.delete(id);
			this.confirmedModels.delete(id);
			this.flushRefresh();
		}
	}

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

	startLogin = async (
		id: string
	): Promise<{ok: true; login: LoginPrompt} | {ok: false; notice: string}> => {
		if (!this.view.engineReady || this.view.status === 'disabled') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const res = await this.api.startProviderLogin(id);
		if (!res.ok) {
			this.setView({...this.view, notice: res.notice, status: 'ready'});
			return {ok: false, notice: res.notice};
		}
		return {ok: true, login: res.login};
	};

	finishLogin = async (id: string, login: LoginPrompt): Promise<boolean> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return false;
		const res = await this.api.finishProviderLogin(id, login);
		if (!res.ok) {
			this.setView({...this.view, notice: res.notice, status: 'ready'});
			return false;
		}
		this.setView(viewOf(upsertLocal(this.view.providers, res.provider), 'ready', null, true));
		return true;
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
	startLogin: (
		id: string
	) => Promise<{ok: true; login: LoginPrompt} | {ok: false; notice: string}>;
	finishLogin: (id: string, login: LoginPrompt) => Promise<boolean>;
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
		searchModels: providersStore.searchModels,
		startLogin: providersStore.startLogin,
		finishLogin: providersStore.finishLogin
	};
}
