import {useEffect, useSyncExternalStore} from 'react';
import type {SettingsDoc} from '@fast-ide/session-view';

export type SettingsStatus = 'loading' | 'ready' | 'error' | 'disabled';

export type GeneralDoc = {
	restoreWorkspace: boolean;
	notifications: boolean;
	soundPrompt: boolean;
	approvalSound: boolean;
	experimental: boolean;
};

export type ModelsDoc = {
	defaultPlatform?: string;
	defaultModel?: string;
	defaultEffort?: string;
	defaultThinking?: boolean;
};

/** Model resolution for child agents — follow session or pin a catalog model. */
export type AgentModelBinding = {
	mode: 'follow' | 'fixed';
	platformId?: string;
	modelId?: string;
};

export type GoalVerdictDoc = {
	onMissingVerdict: 'block' | 'fail';
	verdictAttempts: number;
};

export type MemoryBinding = AgentModelBinding & {enabled: boolean};

export type AgentsDoc = {
	subagent: AgentModelBinding;
	scheduled: AgentModelBinding;
	goalControl: AgentModelBinding;
	goalWork: AgentModelBinding;
	memory: MemoryBinding;
	goal: GoalVerdictDoc;
};

export type SettingsView = {
	status: SettingsStatus;
	general: GeneralDoc;
	models: ModelsDoc;
	agents: AgentsDoc;
	docs: SettingsDoc[];
	notice: string | null;
	engineReady: boolean;
};

const DEFAULT_GENERAL: GeneralDoc = {
	restoreWorkspace: true,
	notifications: true,
	soundPrompt: true,
	approvalSound: true,
	experimental: false
};

const DEFAULT_BINDING: AgentModelBinding = {mode: 'follow'};

const DEFAULT_GOAL: GoalVerdictDoc = {onMissingVerdict: 'block', verdictAttempts: 3};

const DEFAULT_MEMORY: MemoryBinding = {mode: 'follow', enabled: true};

const DEFAULT_AGENTS: AgentsDoc = {
	subagent: {...DEFAULT_BINDING},
	scheduled: {...DEFAULT_BINDING},
	goalControl: {...DEFAULT_BINDING},
	goalWork: {...DEFAULT_BINDING},
	memory: {...DEFAULT_MEMORY},
	goal: {...DEFAULT_GOAL}
};

type SettingsApi = {
	getSettings: (
		scope: 'global' | 'project' | 'effective',
		scopeId?: string
	) => Promise<{ok: true; settings: SettingsDoc[]} | {ok: false; notice: string}>;
	patchSettings: (
		scope: 'global' | 'project',
		namespace: string,
		patch: unknown,
		scopeId?: string
	) => Promise<{ok: true; setting: SettingsDoc} | {ok: false; notice: string}>;
	onSettingsChanged?: (
		handler: (payload: {scope: string; scopeId: string; namespace: string}) => void
	) => () => void;
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function generalDoc(payload: unknown): GeneralDoc {
	if (!isRecord(payload)) return {...DEFAULT_GENERAL};
	return {
		restoreWorkspace:
			typeof payload.restoreWorkspace === 'boolean'
				? payload.restoreWorkspace
				: DEFAULT_GENERAL.restoreWorkspace,
		notifications:
			typeof payload.notifications === 'boolean'
				? payload.notifications
				: DEFAULT_GENERAL.notifications,
		soundPrompt:
			typeof payload.soundPrompt === 'boolean'
				? payload.soundPrompt
				: DEFAULT_GENERAL.soundPrompt,
		approvalSound:
			typeof payload.approvalSound === 'boolean'
				? payload.approvalSound
				: DEFAULT_GENERAL.approvalSound,
		experimental:
			typeof payload.experimental === 'boolean'
				? payload.experimental
				: DEFAULT_GENERAL.experimental
	};
}

export function modelsDoc(payload: unknown): ModelsDoc {
	if (!isRecord(payload)) return {};
	const out: ModelsDoc = {};
	if (typeof payload.defaultPlatform === 'string' && payload.defaultPlatform.trim()) {
		out.defaultPlatform = payload.defaultPlatform.trim();
	}
	if (typeof payload.defaultModel === 'string' && payload.defaultModel.trim()) {
		out.defaultModel = payload.defaultModel.trim();
	}
	if (typeof payload.defaultEffort === 'string' && payload.defaultEffort.trim()) {
		out.defaultEffort = payload.defaultEffort.trim();
	}
	if (typeof payload.defaultThinking === 'boolean') {
		out.defaultThinking = payload.defaultThinking;
	}
	return out;
}

function agentModelBinding(raw: unknown): AgentModelBinding {
	if (!isRecord(raw)) return {...DEFAULT_BINDING};
	const mode = raw.mode === 'fixed' ? 'fixed' : 'follow';
	if (mode === 'follow') return {mode: 'follow'};
	const platformId =
		typeof raw.platformId === 'string' && raw.platformId.trim() ? raw.platformId.trim() : undefined;
	const modelId =
		typeof raw.modelId === 'string' && raw.modelId.trim() ? raw.modelId.trim() : undefined;
	const out: AgentModelBinding = {mode: 'fixed'};
	if (platformId) out.platformId = platformId;
	if (modelId) out.modelId = modelId;
	return out;
}

/** Empty / non-numeric → undefined so a number input can stay blank while typing. */
export function clampVerdictAttempts(raw: unknown): number | undefined {
	if (typeof raw === 'number') {
		if (!Number.isFinite(raw)) return undefined;
		return Math.min(20, Math.max(1, Math.trunc(raw)));
	}
	if (typeof raw === 'string') {
		const t = raw.trim();
		if (t === '') return undefined;
		const n = Number(t);
		if (!Number.isFinite(n)) return undefined;
		return Math.min(20, Math.max(1, Math.trunc(n)));
	}
	return undefined;
}

function goalVerdictDoc(raw: unknown): GoalVerdictDoc {
	if (!isRecord(raw)) return {...DEFAULT_GOAL};
	const onMissingVerdict = raw.onMissingVerdict === 'fail' ? 'fail' : 'block';
	const verdictAttempts = clampVerdictAttempts(raw.verdictAttempts) ?? DEFAULT_GOAL.verdictAttempts;
	return {onMissingVerdict, verdictAttempts};
}

function memoryBinding(raw: unknown): MemoryBinding {
	const binding = agentModelBinding(raw);
	const enabled = !isRecord(raw) || raw.enabled !== false;
	return {...binding, enabled};
}

export function agentsDoc(payload: unknown): AgentsDoc {
	if (!isRecord(payload)) {
		return {
			subagent: {...DEFAULT_BINDING},
			scheduled: {...DEFAULT_BINDING},
			goalControl: {...DEFAULT_BINDING},
			goalWork: {...DEFAULT_BINDING},
			memory: {...DEFAULT_MEMORY},
			goal: {...DEFAULT_GOAL}
		};
	}
	return {
		subagent: agentModelBinding(payload.subagent),
		scheduled: agentModelBinding(payload.scheduled),
		goalControl: agentModelBinding(payload.goalControl),
		goalWork: agentModelBinding(payload.goalWork),
		memory: memoryBinding(payload.memory),
		goal: goalVerdictDoc(payload.goal)
	};
}

function docPayload(docs: SettingsDoc[], namespace: string): unknown {
	return docs.find(d => d.namespace === namespace)?.payload;
}

function viewFromDocs(docs: SettingsDoc[], status: SettingsStatus, notice: string | null, engineReady: boolean): SettingsView {
	return {
		status,
		general: generalDoc(docPayload(docs, 'general')),
		models: modelsDoc(docPayload(docs, 'models')),
		agents: agentsDoc(docPayload(docs, 'agents')),
		docs,
		notice,
		engineReady
	};
}

function liveApi(): SettingsApi {
	return {
		getSettings: (...args) => window.fastIde.getSettings(...args),
		patchSettings: (...args) => window.fastIde.patchSettings(...args),
		onSettingsChanged: handler => window.fastIde.onSettingsChanged(handler)
	};
}

class SettingsStore {
	private view: SettingsView = viewFromDocs([], 'loading', null, false);
	private listeners = new Set<() => void>();
	private inflight: Promise<void> | null = null;
	private generation = 0;
	private api: SettingsApi = liveApi();

	/** Test seam — swap IPC for an in-memory double. */
	bindApi(api: SettingsApi): void {
		this.api = api;
	}

	/** Test seam — clear cached view between cases. */
	resetForTest(): void {
		this.generation += 1;
		this.inflight = null;
		this.view = viewFromDocs([], 'loading', null, false);
		this.publish();
	}

	getSnapshot = (): SettingsView => this.view;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	private publish(): void {
		for (const listener of this.listeners) listener();
	}

	private setView(next: SettingsView): void {
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
		void this.load();
	}

	load = async (opts?: {quiet?: boolean}): Promise<void> => {
		if (!this.view.engineReady) {
			this.setView({...this.view, status: 'disabled', notice: null});
			return;
		}
		const gen = ++this.generation;
		// Keep current UI while revalidating — PatchSettings fans out settings_changed and
		// must not flash Behavior checkboxes back through the loading empty-state.
		const quiet = opts?.quiet === true && this.view.status === 'ready';
		if (!quiet) {
			this.setView({...this.view, status: 'loading', notice: null});
		}
		const run = this.api.getSettings('global').then(res => {
			if (gen !== this.generation) return;
			if (!res.ok) {
				this.setView(viewFromDocs(this.view.docs, quiet ? 'ready' : 'error', res.notice, true));
				return;
			}
			this.setView(viewFromDocs(res.settings, 'ready', null, true));
		});
		this.inflight = run.finally(() => {
			if (this.inflight === run) this.inflight = null;
		});
		await this.inflight;
	};

	retry = (): void => {
		void this.load();
	};

	invalidate = (): void => {
		if (!this.view.engineReady) return;
		void this.load({quiet: true});
	};

	patch = async (namespace: string, patch: Record<string, unknown>): Promise<boolean> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return false;
		const prev = this.view;
		const optimisticDocs = upsertDoc(prev.docs, namespace, patch);
		this.setView(viewFromDocs(optimisticDocs, 'ready', null, true));
		const res = await this.api.patchSettings('global', namespace, patch);
		if (!res.ok) {
			this.setView({...prev, notice: res.notice, status: 'ready'});
			return false;
		}
		const docs = upsertDoc(this.view.docs, namespace, res.setting.payload, res.setting);
		this.setView(viewFromDocs(docs, 'ready', null, true));
		return true;
	};

	patchGeneral = (patch: Partial<GeneralDoc>): Promise<boolean> =>
		this.patch('general', patch as Record<string, unknown>);

	/** RFC 7386 — pass `null` to delete a field (e.g. effort when model has no ladder). */
	patchModels = (patch: Record<string, unknown>): Promise<boolean> => this.patch('models', patch);

	patchAgents = (patch: Partial<AgentsDoc>): Promise<boolean> =>
		this.patch('agents', patch as Record<string, unknown>);
}

function upsertDoc(
	docs: SettingsDoc[],
	namespace: string,
	payloadOrPatch: unknown,
	fromServer?: SettingsDoc
): SettingsDoc[] {
	const idx = docs.findIndex(d => d.namespace === namespace);
	if (fromServer) {
		if (idx < 0) return [...docs, fromServer];
		const next = [...docs];
		next[idx] = fromServer;
		return next;
	}
	const base = idx >= 0 ? docs[idx]! : {
		scope: 'global',
		scopeId: 'default',
		namespace,
		payload: {},
		schemaVersion: 1
	};
	const prevPayload = isRecord(base.payload) ? base.payload : {};
	const patch = isRecord(payloadOrPatch) ? payloadOrPatch : {};
	const merged: Record<string, unknown> = {...prevPayload};
	for (const [k, v] of Object.entries(patch)) {
		if (v === null) delete merged[k];
		else merged[k] = v;
	}
	const row: SettingsDoc = {...base, payload: merged};
	if (idx < 0) return [...docs, row];
	const next = [...docs];
	next[idx] = row;
	return next;
}

export const settingsStore = new SettingsStore();

let pushBound = false;

function ensurePush(): void {
	if (pushBound) return;
	pushBound = true;
	const api = liveApi();
	api.onSettingsChanged?.(payload => {
		if (payload.scope !== 'global') return;
		settingsStore.invalidate();
	});
}

/** Global settings documents (Engine DB) — General / Models / Agents. */
export function useSettings(engineReady: boolean): SettingsView & {
	retry: () => void;
	patchGeneral: (patch: Partial<GeneralDoc>) => Promise<boolean>;
	patchModels: (patch: Record<string, unknown>) => Promise<boolean>;
	patchAgents: (patch: Partial<AgentsDoc>) => Promise<boolean>;
} {
	useEffect(() => {
		ensurePush();
		settingsStore.setEngineReady(engineReady);
	}, [engineReady]);

	const view = useSyncExternalStore(
		settingsStore.subscribe,
		settingsStore.getSnapshot,
		settingsStore.getSnapshot
	);

	return {
		...view,
		retry: settingsStore.retry,
		patchGeneral: settingsStore.patchGeneral,
		patchModels: settingsStore.patchModels,
		patchAgents: settingsStore.patchAgents
	};
}
