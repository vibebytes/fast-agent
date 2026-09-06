import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {
	mergePlanPatch,
	planBuildDisplayContent,
	planFromWire,
	type PlanView
} from '../plan.js';
import {entryMatchesKey} from '../turnIdentity.js';
import {runChromeTransition} from '../runChrome.js';
import {sealOpenThinking} from './entry.js';
import type {TranscriptEntry, TranscriptState} from './state.js';

export function applyMessagePatched(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'message_patched'}>
): TranscriptState {
	const incoming = planFromWire({
		planId: event.planId,
		messageId: event.messageId,
		name: event.name,
		overview: event.overview,
		todos: event.todos,
		body: event.body,
		payloadJson: event.payloadJson
	});
	if (!incoming) return state;
	return applyPlanPatch(state, incoming, event.action ?? 'update', event.turnId ?? event.runId);
}

export function applyPlanBuildSubmitted(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'plan_build_submitted'}>
): TranscriptState {
	return applyPlanBuildSubmittedFields(state, {
		messageId: event.messageId,
		planId: event.planId,
		content: event.content ?? '',
		name: event.name ?? '',
		runId: event.runId
	});
}

/** Peer / stream path: bind PlanBuild fields onto the execute-turn user row. */
function applyPlanBuildSubmittedFields(
	state: TranscriptState,
	ev: {messageId: string; planId: string; content: string; name: string; runId?: string}
): TranscriptState {
	const planId = ev.planId.trim();
	const messageId = ev.messageId.trim();
	if (!planId) return state;
	const display = ev.content.trim() || planBuildDisplayContent(ev.name, planId);
	const name = ev.name.trim() || undefined;

	const already = state.entries.some(
		e => e.role === 'user' && e.messageType === 'plan_build' && e.planId === planId
	);
	if (already) {
		return {
			...state,
			entries: state.entries.map(entry => {
				if (entry.role !== 'user' || entry.planId !== planId) return entry;
				return {
					...entry,
					messageType: 'plan_build',
					planId,
					...(name ? {planName: name} : {}),
					text: entry.text.trim() ? entry.text : display
				};
			})
		};
	}

	// Patch the user for this execute turn. Before input_accepted remap, entry.turnId is
	// still clientMessageId while event.runId is the server Run id — fall back to the user
	// paired with the live streaming assistant (avoid orphan double-insert).
	const runId = ev.runId?.trim();
	const streamingAssistant = [...state.entries]
		.reverse()
		.find(a => a.role === 'assistant' && a.status === 'streaming');
	const pairedUserId = (() => {
		if (!streamingAssistant) return undefined;
		const idx = state.entries.indexOf(streamingAssistant);
		for (let i = idx - 1; i >= 0; i--) {
			const e = state.entries[i];
			if (e?.role === 'user') return e.id;
		}
		return undefined;
	})();
	const targetUser = state.entries.find(entry => {
		if (entry.role !== 'user') return false;
		if (runId && (entry.turnId === runId || entry.clientMessageId === runId)) return true;
		if (pairedUserId && entry.id === pairedUserId) return true;
		return false;
	});
	if (targetUser) {
		return {
			...state,
			entries: state.entries.map(entry => {
				if (entry.id !== targetUser.id) return entry;
				return {
					...entry,
					id: messageId ? `user-${messageId}` : entry.id,
					text: entry.text.trim() ? entry.text : display,
					messageType: 'plan_build',
					planId,
					...(name ? {planName: name} : {}),
					...(runId ? {turnId: runId} : {})
				};
			})
		};
	}

	// Orphan PlanBuild (peer missed turn_started): seed user + streaming assistant.
	const turnKey = runId || messageId || `pb-${planId}`;
	return {
		...state,
		entries: [
			...state.entries,
			{
				id: `user-${messageId || turnKey}`,
				role: 'user',
				text: display,
				status: 'done',
				turnId: turnKey,
				clientMessageId: messageId || turnKey,
				messageType: 'plan_build',
				planId,
				...(name ? {planName: name} : {})
			},
			{
				id: `assistant-${turnKey}`,
				role: 'assistant',
				text: '',
				reasoning: '',
				status: 'streaming',
				turnId: turnKey,
				clientMessageId: turnKey,
				tools: [],
				segments: []
			}
		],
		chrome: runChromeTransition(state.chrome, {
			...(runId ? {run: {id: runId, fromServer: true}} : {}),
			postRun: false
		}),
		lastDocumentId: turnKey
	};
}

/** Create/replace/update a Plan segment by plan_id across transcript entries. */
function applyPlanPatch(
	state: TranscriptState,
	incoming: PlanView,
	action: string,
	turnId?: string
): TranscriptState {
	const planId = incoming.planId;
	let found = false;
	const entries = state.entries.map(entry => {
		if (entry.role !== 'assistant') return entry;
		const segments = entry.segments ?? [];
		const idx = segments.findIndex(s => s.kind === 'plan' && s.plan.planId === planId);
		if (idx < 0) return entry;
		found = true;
		const prev = segments[idx]!;
		if (prev.kind !== 'plan') return entry;
		const nextPlan = mergePlanPatch(prev.plan, incoming, action);
		return {
			...entry,
			segments: segments.map((s, i) =>
				i === idx && s.kind === 'plan' ? {...s, plan: nextPlan} : s
			)
		};
	});
	if (found) return {...state, entries};

	const targetIdx = findPlanHostEntryIndex(entries, turnId);
	if (targetIdx >= 0) {
		const host = entries[targetIdx]!;
		const sealed = sealOpenThinking(host);
		const segments = sealed.segments ?? [];
		entries[targetIdx] = {
			...sealed,
			segments: [
				...segments,
				{kind: 'plan', id: `seg-plan-${planId}`, plan: incoming}
			]
		};
		return {...state, entries};
	}

	return {
		...state,
		entries: [
			...entries,
			{
				id: `plan-${planId}`,
				role: 'assistant',
				text: '',
				status: 'done',
				turnId,
				segments: [{kind: 'plan', id: `seg-plan-${planId}`, plan: incoming}]
			}
		]
	};
}

function findPlanHostEntryIndex(entries: TranscriptEntry[], turnId?: string): number {
	if (turnId) {
		for (let i = entries.length - 1; i >= 0; i -= 1) {
			const e = entries[i]!;
			if (e.role !== 'assistant') continue;
			if (entryMatchesKey(e, turnId)) return i;
		}
	}
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const e = entries[i]!;
		if (e.role === 'assistant' && e.status === 'streaming') return i;
	}
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		if (entries[i]!.role === 'assistant') return i;
	}
	return -1;
}
