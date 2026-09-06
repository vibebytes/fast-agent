import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {forgetDocument} from '../chatDocument.js';
import {
	chromeAwaitingSettlement,
	chromeRunId,
	runChromeTransition
} from '../runChrome.js';
import {entryMatchesKey} from '../turnIdentity.js';
import {sealOpenThinking} from './entry.js';
import type {ToolCallView, TranscriptEntry, TranscriptState} from './state.js';

function localBusy(state: TranscriptState): boolean {
	return Boolean(chromeRunId(state.chrome)) || state.entries.some(e => e.status === 'streaming');
}

function keepFault(
	prev: TranscriptEntry['fault'],
	next: TranscriptEntry['fault']
): TranscriptEntry['fault'] {
	if (!next) return prev;
	if (!prev) return next;
	return {
		...next,
		acceptedTurns: next.acceptedTurns ?? prev.acceptedTurns,
		attempts: next.attempts ?? prev.attempts,
		retryableAfterMs: next.retryableAfterMs ?? prev.retryableAfterMs
	};
}

/** Attach snapshot said the chat run is still live after a local idle settle. */
function reviveChatRun(state: TranscriptState, runId: string): TranscriptState {
	let revived = false;
	const entries = state.entries.map(entry => {
		if (entry.role !== 'assistant') return entry;
		if (entry.turnId !== runId && entry.clientMessageId !== runId) return entry;
		if (entry.status === 'cancelled' || entry.status === 'error') return entry;
		revived = true;
		if (entry.status === 'streaming') return entry;
		return {...entry, status: 'streaming' as const};
	});
	if (!revived) return state;
	return {
		...state,
		chrome: runChromeTransition(state.chrome, {
			run: {id: runId, fromServer: true},
			postRun: false,
			awaiting: false
		}),
		entries
	};
}

export function applyLocalCancel(state: TranscriptState): TranscriptState {
	return {
		...forgetDocument(state),
		approvals: state.approvals.filter(a => !a.runId),
		questions: [],
		questionBatches: state.questionBatches.filter(q => !q.runId),
		chrome: runChromeTransition(state.chrome, {postRun: true, awaiting: true}),
		entries: state.entries.map(entry => {
			if (entry.role !== 'assistant' || entry.status !== 'streaming') return entry;
			return {
				...sealOpenThinking(entry),
				status: 'cancelled',
				tools: (entry.tools ?? []).map(t =>
					t.status === 'running' ? {...t, status: 'cancelled'} : t
				)
			};
		})
	};
}

/** Lease / attach snapshot said idle while local chrome is still busy. */
export function applyLeaseExpiry(state: TranscriptState): TranscriptState {
	return {
		...forgetDocument(state),
		chrome: runChromeTransition(state.chrome, {run: 'clear', postRun: true, awaiting: false}),
		leaseAware: false,
		runLease: {state: 'idle'},
		entries: state.entries.map(entry => {
			if (entry.role !== 'assistant' || entry.status !== 'streaming') return entry;
			return {
				...sealOpenThinking(entry),
				status: 'done',
				tools: (entry.tools ?? []).map(t =>
					t.status === 'running' ? {...t, status: 'cancelled'} : t
				)
			};
		})
	};
}

export function applyRunTerminal(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'run_cancelled' | 'run_done' | 'run_failed' | 'run_exhausted'}>
): TranscriptState {
	const runId = event.runId;
	const touchesActive = Boolean(runId) && chromeRunId(state.chrome) === runId;
	const isFail = event.type === 'run_failed' || event.type === 'run_exhausted';
	const matchesEntry = (entry: TranscriptEntry): boolean =>
		Boolean(runId) && entryMatchesKey(entry, runId);
	const matchesLiveStream = (entry: TranscriptEntry): boolean =>
		isFail && entry.status === 'streaming' && entryMatchesKey(entry, chromeRunId(state.chrome));
	const sealsEntry = (entry: TranscriptEntry): boolean =>
		entry.role === 'assistant' &&
		entry.messageType !== 'goal_step_conclusion' &&
		entry.messageType !== 'goal_outcome' &&
		(isFail
			? entry.status !== 'cancelled' &&
				(matchesEntry(entry) ||
					(touchesActive && entry.status === 'streaming') ||
					matchesLiveStream(entry))
			: entry.status === 'streaming' && (matchesEntry(entry) || touchesActive));
	const hasMatch = state.entries.some(sealsEntry);
	const nextApprovals = state.approvals.filter(a => !a.runId || a.runId !== runId);
	const nextQuestions = state.questions.filter(q => q.runId !== runId);
	const nextBatches = state.questionBatches.filter(q => !q.runId || q.runId !== runId);
	const clearedPending =
		nextApprovals.length !== state.approvals.length
		|| nextQuestions.length !== state.questions.length
		|| nextBatches.length !== state.questionBatches.length;
	const entryStatus: TranscriptEntry['status'] =
		event.type === 'run_cancelled' ? 'cancelled' : event.type === 'run_done' && event.success ? 'done' : 'error';
	const toolStatus: ToolCallView['status'] =
		entryStatus === 'done' ? 'success' : entryStatus === 'cancelled' ? 'cancelled' : 'error';
	const failText =
		event.type === 'run_failed'
			? event.error.trim()
			: event.type === 'run_exhausted'
				? event.reason.trim()
				: event.type === 'run_cancelled'
					? event.reason.trim()
					: '';
	const fault = event.type === 'run_failed' ? event.fault : undefined;
	if (!hasMatch && !touchesActive) {
		if (isFail && runId) {
			const synthesized: TranscriptEntry = {
				id: `assistant-${runId}`,
				role: 'assistant',
				text: failText,
				status: 'error',
				turnId: runId,
				...(fault ? {fault} : {}),
				tools: [],
				segments: []
			};
			return {
				...forgetDocument(state, runId),
				chrome: runChromeTransition(
					state.chrome,
					chromeRunId(state.chrome) === runId
						? {run: 'clear', postRun: true, awaiting: false}
						: {postRun: true}
				),
				approvals: nextApprovals,
				questions: nextQuestions,
				questionBatches: nextBatches,
				entries: [...state.entries, synthesized]
			};
		}
		if (!clearedPending) return state;
		return {...state, approvals: nextApprovals, questions: nextQuestions, questionBatches: nextBatches};
	}

	const entries = state.entries.map(entry => {
		if (!sealsEntry(entry)) return entry;
		const sealed = sealOpenThinking(entry);
		const {waitState: _w, ...rest} = sealed;
		return {
			...rest,
			status: entryStatus,
			text: isFail && failText ? failText : (rest.text.trim() || failText || rest.text),
			fault: event.type === 'run_failed' ? keepFault(rest.fault, event.fault) : rest.fault,
			...(isFail && runId ? {turnId: runId} : {}),
			tools: (entry.tools ?? []).map(t =>
				t.status === 'running' ? {...t, status: toolStatus} : t
			)
		};
	});
	const stillStreaming = entries.some(
		e => e.role === 'assistant' && e.status === 'streaming'
	);
	const extinguishActive =
		chromeRunId(state.chrome) === runId ||
		(isFail && Boolean(chromeRunId(state.chrome)) && !stillStreaming && hasMatch);
	return {
		...forgetDocument(state, runId),
		chrome: runChromeTransition(state.chrome, {
			run: extinguishActive ? 'clear' : 'keep',
			postRun: stillStreaming ? false : hasMatch ? true : 'keep'
		}),
		leaseAware: stillStreaming ? state.leaseAware : false,
		runLease: stillStreaming ? state.runLease : undefined,
		approvals: nextApprovals,
		questions: nextQuestions,
		questionBatches: nextBatches,
		entries
	};
}

export function applyRunState(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'run_state'}>
): TranscriptState {
	const runLease = {
		...(event.runId ? {runId: event.runId} : {}),
		state: event.state
	};
	if (event.state === 'idle') {
		const next = {...state, runLease};
		if (state.leaseAware && localBusy(state)) return applyLeaseExpiry(next);
		return {...next, leaseAware: false};
	}
	const marked = {...state, runLease, leaseAware: true as const};
	if (chromeAwaitingSettlement(state.chrome) && event.state === 'running') return marked;
	if (
		!localBusy(marked) &&
		event.runId &&
		(event.state === 'running' || event.state === 'waiting' || event.state === 'cancelling')
	) {
		return reviveChatRun(marked, event.runId);
	}
	return marked;
}
