import type {DshCallResult, DshModelsResult, DshModelsValue, DshSelection} from '@fast-ide/session-view';

export type {DshModelFailure, DshModelGroup, DshModelsValue, DshSelection} from '@fast-ide/session-view';

type DshCall = (
	method: string,
	payload?: Record<string, unknown>,
	sessionId?: string
) => Promise<DshCallResult>;

export async function getDshModels(call: DshCall, sessionId?: string): Promise<DshModelsResult> {
	const result = await call('session.models', sessionId ? {sessionId} : {}, sessionId);
	if (!result.ok) return result;
	const parsed = asModels(result.value);
	if (!parsed) return {ok: false, error: {code: 'internal', message: 'session.models shape'}};
	return {ok: true, value: parsed};
}

export function selectDshModel(
	call: DshCall,
	input: DshSelection & {sessionId?: string}
): Promise<DshCallResult> {
	return call(
		'session.selectModel',
		{
			...(input.sessionId ? {sessionId: input.sessionId} : {}),
			provider: input.provider,
			model: input.model,
			...(input.reasoningEffort ? {reasoningEffort: input.reasoningEffort} : {})
		},
		input.sessionId
	);
}

export function asModels(value: unknown): DshModelsValue | null {
	if (!value || typeof value !== 'object') return null;
	const v = value as Record<string, unknown>;
	const current = v.current;
	if (!current || typeof current !== 'object') return null;
	const c = current as Record<string, unknown>;
	if (typeof c.provider !== 'string' || typeof c.model !== 'string') return null;
	return {
		current: {
			provider: c.provider,
			model: c.model,
			...(typeof c.reasoningEffort === 'string' ? {reasoningEffort: c.reasoningEffort} : {})
		},
		routable: v.routable === true,
		groups: Array.isArray(v.groups) ? (v.groups as DshModelsValue['groups']) : [],
		failures: Array.isArray(v.failures) ? (v.failures as DshModelsValue['failures']) : []
	};
}
