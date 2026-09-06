import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {documentCard, rememberDocument} from '../chatDocument.js';
import {chromePostRun, chromeRunId, runChromeTransition} from '../runChrome.js';
import {entryMatchesKey, sameTurn} from '../turnIdentity.js';
import {
	applyCheckpoint,
	clearWaitState,
	markStreamIncomplete,
	patchAssistant,
	persistDelta,
	pushAssistantSegment,
	pushThinkingSegment
} from './entry.js';
import {subagentRunIdOf} from './tools.js';
import type {TranscriptEntry, TranscriptState} from './state.js';

export function fillsEmptyAssistant(state: TranscriptState, event: BridgeEvent): boolean {
	if (
		event.type !== 'final_answer' &&
		event.type !== 'checkpoint' &&
		event.type !== 'assistant_delta'
	)
		return false;
	const turnId = 'turnId' in event && typeof event.turnId === 'string' ? event.turnId : undefined;
	const text =
		event.type === 'checkpoint'
			? event.content
			: 'text' in event && typeof event.text === 'string'
				? event.text
				: '';
	if (!text.trim()) return false;
	const card = documentCard(state, turnId);
	return Boolean(card && !card.text.trim());
}

export function applyLlmNetworkWait(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'llm_network_wait'}>
): TranscriptState {
	return patchAssistant(state, event.runId, entry => {
		if (entry.status !== 'streaming') return entry;
		if (event.phase === 'cleared') {
			if (!entry.waitState) return entry;
			const {waitState: _removed, ...rest} = entry;
			return rest;
		}
		if (event.phase === 'retrying' || event.phase === 'waiting') {
			const discard =
				event.phase === 'retrying' && 'discard' in event && event.discard === true;
			const cleared = discard
				? {...entry, text: '', reasoning: undefined, segments: undefined}
				: entry;
			return {
				...cleared,
				waitState: {
					phase: event.phase,
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					reason: event.reason,
					elapsedMs: event.elapsedMs
				}
			};
		}
		return entry;
	});
}

export function applyReasoningDelta(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'reasoning_delta'}>
): TranscriptState {
	if (subagentRunIdOf(event)) return state;
	return patchAssistant(state, event.turnId, entry =>
		clearWaitState(pushThinkingSegment(entry, event.text))
	);
}

export function applyAssistantDelta(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'assistant_delta'}>
): TranscriptState {
	if (subagentRunIdOf(event)) return state;
	if (
		event.turnId &&
		!chromePostRun(state.chrome) &&
		!documentCard(state, event.turnId, {strictTurn: true})
	) {
		const candidate = documentCard(state);
		const unconfirmed =
			candidate &&
			candidate.status === 'streaming' &&
			(!candidate.turnId || candidate.turnId === candidate.clientMessageId);
		if (candidate && unconfirmed) {
			const wasActive = entryMatchesKey(candidate, chromeRunId(state.chrome));
			return rememberDocument(
				{
					...state,
					chrome: wasActive
						? runChromeTransition(state.chrome, {run: {id: event.turnId, fromServer: true}})
						: state.chrome,
					entries: state.entries.map(entry => {
						if (entry === candidate) {
							return {
								...clearWaitState(
									pushAssistantSegment(entry, event.text, event.unitId, persistDelta(event))
								),
								turnId: event.turnId
							};
						}
						const pairedUser = entry.role === 'user' && sameTurn(entry, candidate);
						return pairedUser ? {...entry, turnId: event.turnId} : entry;
					})
				},
				event.turnId
			);
		}
		const fresh: TranscriptEntry = {
			id: `assistant-${event.turnId}`,
			role: 'assistant',
			text: '',
			reasoning: '',
			status: 'streaming',
			turnId: event.turnId,
			tools: [],
			segments: []
		};
		const seeded = clearWaitState(
			pushAssistantSegment(fresh, event.text, event.unitId, persistDelta(event))
		);
		return {
			...rememberDocument(state, event.turnId),
			entries: [...state.entries, seeded]
		};
	}
	return patchAssistant(state, event.turnId, entry =>
		clearWaitState(pushAssistantSegment(entry, event.text, event.unitId, persistDelta(event)))
	);
}

export function applyCheckpointEvent(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'checkpoint'}>
): TranscriptState {
	return patchAssistant(state, event.turnId, entry => applyCheckpoint(entry, event.unitId, event.content));
}

export function applyGap(state: TranscriptState): TranscriptState {
	return markStreamIncomplete(state);
}

export function applyFinalAnswer(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'final_answer'}>
): TranscriptState {
	return patchAssistant(state, event.turnId, entry =>
		entry.text.trim().length > 0 ? entry : pushAssistantSegment(entry, event.text, undefined, persistDelta(event))
	);
}
