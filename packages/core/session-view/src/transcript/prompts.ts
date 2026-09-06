import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {chromePostRun, chromeRunId, runChromeTransition} from '../runChrome.js';
import {entryMatchesKey} from '../turnIdentity.js';
import type {TranscriptState} from './state.js';

/** Cold/settled restore: history is done and no assistant is still streaming. */
function settledAttachReplay(state: TranscriptState): boolean {
	return chromePostRun(state.chrome) && !state.entries.some(e => e.status === 'streaming');
}

/** Persist prompt replay after settle must paint the card, but must not re-arm Stop. */
function armRunIfLive(state: TranscriptState, runId: string): Pick<TranscriptState, 'chrome'> {
	if (settledAttachReplay(state)) return {chrome: state.chrome};
	return {
		chrome: runChromeTransition(state.chrome, runId ? {run: {id: runId, fromServer: true}} : {})
	};
}

export function applyApprovalRequested(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'approval_requested'}>
): TranscriptState {
	const runId = event.runId ?? event.turnId ?? '';
	const entries = state.entries.map(entry => {
		if (entry.role !== 'assistant' || entry.status !== 'streaming') return entry;
		const sameRun =
			entryMatchesKey(entry, runId) || entryMatchesKey(entry, chromeRunId(state.chrome));
		return sameRun ? {...entry, status: 'done' as const} : entry;
	});
	return {
		...state,
		entries,
		...armRunIfLive(state, runId),
		approvals: [
			...state.approvals.filter(a => a.id !== event.id),
			{
				id: event.id,
				runId,
				tool: event.tool,
				description: event.description,
				risk: event.risk,
				context: event.context,
				note: event.note
			}
		]
	};
}

export function applyApprovalCleared(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'approval_resolved' | 'approval_expired'}>
): TranscriptState {
	return {
		...state,
		approvals: state.approvals.filter(a => a.id !== event.id)
	};
}

export function applyQuestionRequested(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'question_requested'}>
): TranscriptState {
	const runId = event.runId ?? event.turnId;
	if (!runId) return state;
	const entries = state.entries.map(entry => {
		if (entry.role !== 'assistant' || entry.status !== 'streaming') return entry;
		const sameRun =
			entryMatchesKey(entry, runId) || entryMatchesKey(entry, chromeRunId(state.chrome));
		return sameRun ? {...entry, status: 'done' as const} : entry;
	});
	return {
		...state,
		entries,
		...armRunIfLive(state, runId),
		questions: [
			...state.questions.filter(q => q.id !== event.id),
			{
				id: event.id,
				runId,
				title: event.title,
				question: event.question,
				options: event.options.map(o => ({
					id: o.id,
					label: o.label,
					description: o.description
				})),
				allowCustom: event.allowCustom
			}
		]
	};
}

export function applyQuestionBatchRequested(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'question_batch_requested'}>
): TranscriptState {
	const runId = event.runId ?? event.turnId ?? '';
	const entries = state.entries.map(entry => {
		if (entry.role !== 'assistant' || entry.status !== 'streaming') return entry;
		const sameRun =
			entryMatchesKey(entry, runId) || entryMatchesKey(entry, chromeRunId(state.chrome));
		return sameRun ? {...entry, status: 'done' as const} : entry;
	});
	return {
		...state,
		entries,
		...armRunIfLive(state, runId),
		questionBatches: [
			...state.questionBatches.filter(q => q.rpcId !== event.rpcId),
			{
				rpcId: event.rpcId,
				runId,
				questions: event.questions.map(q => ({
					id: q.id,
					question: q.question,
					detail: q.detail,
					header: q.header,
					options: q.options,
					multiSelect: q.multiSelect,
					intent: q.intent
				}))
			}
		]
	};
}

export function applyQuestionBatchResolved(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'question_batch_resolved'}>
): TranscriptState {
	return {
		...state,
		questionBatches: state.questionBatches.filter(q => q.rpcId !== event.rpcId)
	};
}

export function applyQuestionCleared(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'question_answered' | 'clarify_resolved'}>
): TranscriptState {
	return {
		...state,
		questions: state.questions.filter(q => q.id !== event.id)
	};
}

export function applyClarify(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'clarify'}>
): TranscriptState {
	const runId = event.runId ?? event.turnId;
	const id = event.id ?? (runId ? `clarify-${runId}` : undefined);
	if (!runId || !id) return state;
	return {
		...state,
		...armRunIfLive(state, runId),
		questions: [
			...state.questions.filter(q => q.id !== id),
			{
				id,
				runId,
				question: event.question,
				options: [],
				allowCustom: true
			}
		]
	};
}
