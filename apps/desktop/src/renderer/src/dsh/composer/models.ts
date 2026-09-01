import {useSyncExternalStore} from 'react';
import type {DshError, DshModelsValue, DshSelection} from '@fast-ide/session-view';

export type {DshModelsValue, DshSelection};

export type DshModelsSnap = {
	current: DshSelection | null;
	routable: boolean | null;
	groups: DshModelsValue['groups'];
	failures: DshModelsValue['failures'];
	ready: boolean;
	loading: boolean;
	notice: string | null;
	error: DshError | null;
};

const empty: DshModelsSnap = {
	current: null,
	routable: null,
	groups: [],
	failures: [],
	ready: false,
	loading: false,
	notice: null,
	error: null
};

export function failSnap(error: DshError): DshModelsSnap {
	return {
		...empty,
		notice: error.message ?? error.code,
		error
	};
}

export function okSnap(value: DshModelsValue): DshModelsSnap {
	return {
		current: value.current,
		routable: value.routable,
		groups: value.groups,
		failures: value.failures,
		ready: true,
		loading: false,
		notice: null,
		error: null
	};
}

export type MenuPane = 'root' | 'model' | 'effort';

export type CurrentChoice = {
	provider: string;
	modelId: string;
	modelName: string;
	reasoning?: DshModelsValue['groups'][number]['models'][number]['reasoning'];
};

export type EffortChoice = {
	key: string;
	effort?: string;
	label: string;
	description?: string;
};

/** Catalog row for `session.models.current`. Missing from groups → treat as unset. */
export function currentChoice(snap: DshModelsSnap): CurrentChoice | null {
	if (!snap.current) return null;
	const group = snap.groups.find(g => g.id === snap.current?.provider);
	const model = group?.models.find(m => m.id === snap.current?.model);
	if (!group || !model) return null;
	return {provider: group.id, modelId: model.id, modelName: model.name, reasoning: model.reasoning};
}

export function effortLabel(choice: CurrentChoice | null, currentEffort?: string): string | undefined {
	const reasoning = choice?.reasoning;
	if (!reasoning) return undefined;
	const effective = currentEffort ?? reasoning.defaultEffort;
	if (effective === undefined) return 'Default';
	return reasoning.efforts.find(e => e.id === effective)?.name ?? effective;
}

/** DSH-Web: prepend Default only when the adapter did not set a model default. */
export function effortChoices(choice: CurrentChoice | null): EffortChoice[] {
	const reasoning = choice?.reasoning;
	if (!reasoning) return [];
	return [
		...(reasoning.defaultEffort === undefined
			? [{key: 'provider-default', effort: undefined, label: 'Default'}]
			: []),
		...reasoning.efforts.map(e => ({
			key: `effort:${e.id}`,
			effort: e.id,
			label: e.name,
			...(e.description ? {description: e.description} : {})
		}))
	];
}

export function modelChrome(snap: DshModelsSnap): {
	label: string;
	modelLabel: string;
	effortLabel?: string;
	spinning: boolean;
	pane: 'loading' | 'retry' | 'list';
} {
	if (snap.loading && !snap.ready) {
		return {label: '正在加载', modelLabel: '正在加载', spinning: true, pane: 'loading'};
	}
	if (!snap.ready) {
		const notice = snap.notice ?? 'DSH models';
		return {label: notice, modelLabel: notice, spinning: false, pane: 'retry'};
	}
	const choice = currentChoice(snap);
	const effort = effortLabel(choice, snap.current?.reasoningEffort);
	const modelLabel = choice?.modelName ?? '选择模型';
	return {
		label: effort ? `${modelLabel} ${effort}` : modelLabel,
		modelLabel,
		...(effort ? {effortLabel: effort} : {}),
		spinning: snap.loading,
		pane: 'list'
	};
}

let snap: DshModelsSnap = empty;
const listeners = new Set<() => void>();

function emit(next: DshModelsSnap): void {
	snap = next;
	for (const l of listeners) l();
}

export function dshModels(): DshModelsSnap {
	return snap;
}

export function subscribeDshModels(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function useDshModels(): DshModelsSnap {
	return useSyncExternalStore(subscribeDshModels, dshModels, dshModels);
}

export async function refreshDshModels(sessionId?: string): Promise<DshModelsSnap> {
	emit({...snap, loading: true});
	try {
		const get = window.fastIde.getDshModels;
		if (typeof get !== 'function') {
			const next = failSnap({
				code: 'unavailable',
				message: '需要重启应用以加载 DSH 模型通道'
			});
			emit(next);
			return next;
		}
		const result = await get(sessionId);
		const next = result.ok ? okSnap(result.value) : failSnap(result.error);
		emit(next);
		return next;
	} catch (e) {
		const next = failSnap({
			code: 'unavailable',
			message: e instanceof Error ? e.message : String(e)
		});
		emit(next);
		return next;
	}
}

export async function selectDshModel(input: DshSelection, sessionId?: string): Promise<DshError | null> {
	try {
		const select = window.fastIde.selectDshModel;
		if (typeof select !== 'function') {
			const error = {code: 'unavailable', message: '需要重启应用以加载 DSH 模型通道'};
			emit({...snap, loading: false, error, notice: error.message});
			return error;
		}
		const result = await select({
			...input,
			...(sessionId ? {sessionId} : {})
		});
		if (!result.ok) {
			emit({...snap, loading: false, error: result.error, notice: result.error.message ?? result.error.code});
			return result.error;
		}
	} catch (e) {
		const error = {code: 'unavailable', message: e instanceof Error ? e.message : String(e)};
		emit({...snap, loading: false, error, notice: error.message});
		return error;
	}
	await refreshDshModels(sessionId);
	return null;
}

export function openDshModelsSettings(): void {
	window.dispatchEvent(
		new CustomEvent('fast-ide:open-settings', {detail: {suite: 'dsh', section: 'models'}})
	);
}

export function noteDshError(error: DshError): void {
	emit({...snap, error, notice: error.message ?? error.code});
}
