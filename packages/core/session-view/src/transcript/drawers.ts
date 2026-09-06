import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {sameRunId} from '../turnIdentity.js';
import {
	appendProcPreview,
	nextFireAtFromDetail,
	type LiveChildWork,
	type LiveProc,
	type LiveTask,
	type ToolCallView,
	type TranscriptState,
	type TranscriptSubagent
} from './state.js';

const LIVE_TASK_TERMINAL = new Set(['cancelled', 'expired']);

const CHILD_WORK_TERMINAL = new Set([
	'completed',
	'complete',
	'done',
	'success',
	'succeeded',
	'failed',
	'error',
	'cancelled',
	'canceled',
	'expired',
	'killed'
]);

/** Kinds already owned by a richer drawer surface (Goal card / LiveProc). */
const CHILD_WORK_COVERED_KINDS = new Set(['goal', 'proc']);

function upsertSubagent(
	list: TranscriptSubagent[],
	next: TranscriptSubagent
): TranscriptSubagent[] {
	const i = list.findIndex(s => s.childSessionId === next.childSessionId);
	if (i < 0) return [...list, next];
	const copy = list.slice();
	copy[i] = {...list[i], ...next};
	return copy;
}

function statusFromChildWork(status: string): ToolCallView['status'] {
	const s = status.toLowerCase();
	if (s === 'cancelled' || s === 'canceled' || s === 'expired' || s === 'killed') return 'cancelled';
	if (s === 'failed' || s === 'error') return 'error';
	return 'success';
}

/**
 * Feed a delegation tool row (Subagent card) from the unified workload wire
 * (workload-capability.md): the engine-side rolling outputPreview is the card body
 * (tool output + subagent prose, throttled + tail-capped by WorkloadHub), and a
 * terminal child_work status settles a row whose agent_call_finished never arrives
 * (goal steps outliving the chat stream). Entry status is never touched.
 */
export function patchSubagentRowFromChildWork(
	state: TranscriptState,
	runId: string,
	terminalStatus: ToolCallView['status'] | undefined,
	preview: string | undefined,
	statusNote?: string
): TranscriptState {
	for (let i = state.entries.length - 1; i >= 0; i -= 1) {
		const entry = state.entries[i]!;
		if (entry.role !== 'assistant') continue;
		const tools = entry.tools ?? [];
		const target = tools.find(t => sameRunId(t.agentRunId, runId) && t.status === 'running');
		if (!target) continue;
		if (!terminalStatus && preview === undefined && (target.statusNote ?? undefined) === statusNote)
			return state;
		const entries = [...state.entries];
		entries[i] = {
			...entry,
			tools: tools.map(t =>
				sameRunId(t.agentRunId, runId) && t.status === 'running'
					? {
							...t,
							...(preview !== undefined ? {output: preview} : {}),
							// Note follows each running snapshot (a delta snapshot without a
							// summary clears it — output arriving means the wait is over).
							...(terminalStatus ? {status: terminalStatus, statusNote: undefined} : {statusNote})
						}
					: t
			)
		};
		return {...state, entries};
	}
	return state;
}

export function applySubagentStarted(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'subagent_started'}>
): TranscriptState {
	return {
		...state,
		subagents: upsertSubagent(state.subagents ?? [], {
			childSessionId: event.childSessionId,
			mode: event.mode,
			label: event.label ?? '',
			activity: 'running',
			runId: event.runId
		})
	};
}

export function applySubagentUpdated(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'subagent_updated'}>
): TranscriptState {
	const prev = (state.subagents ?? []).find(s => s.childSessionId === event.childSessionId);
	return {
		...state,
		subagents: upsertSubagent(state.subagents ?? [], {
			childSessionId: event.childSessionId,
			mode: prev?.mode ?? 'one-shot',
			label: prev?.label ?? '',
			activity: event.activity,
			status: prev?.status,
			summary: prev?.summary,
			preview: typeof event.preview === 'string' ? event.preview : prev?.preview,
			runId: prev?.runId
		})
	};
}

export function applySubagentFinished(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'subagent_finished'}>
): TranscriptState {
	const prev = (state.subagents ?? []).find(s => s.childSessionId === event.childSessionId);
	return {
		...state,
		subagents: upsertSubagent(state.subagents ?? [], {
			childSessionId: event.childSessionId,
			mode: prev?.mode ?? 'one-shot',
			label: prev?.label ?? '',
			activity: 'inactive',
			status: event.status,
			summary: event.summary,
			preview: prev?.preview,
			runId: prev?.runId
		})
	};
}

export function applyProcUpdated(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'proc_updated'}>
): TranscriptState {
	const procId = event.procId?.trim();
	if (!procId) return state;
	const prev = state.liveProcs ?? [];
	if (event.status === 'running') {
		const existing = prev.find(p => p.procId === procId);
		const next: LiveProc = {
			procId,
			command: event.command?.trim() || existing?.command || procId,
			runId: event.runId ?? existing?.runId,
			outFile: event.outFile ?? existing?.outFile,
			status: 'running',
			reason: event.reason ?? existing?.reason,
			startedAt: existing?.startedAt ?? Date.now(),
			outputPreview: existing?.outputPreview
		};
		return {
			...state,
			liveProcs: [...prev.filter(p => p.procId !== procId), next]
		};
	}
	return {...state, liveProcs: prev.filter(p => p.procId !== procId)};
}

export function applyBackgroundTaskOutput(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'background_task_output'}>
): TranscriptState {
	const procId = event.procId?.trim();
	const text = event.text ?? '';
	if (!procId || !text) return state;
	const prev = state.liveProcs ?? [];
	const existing = prev.find(p => p.procId === procId);
	// Late deltas after terminal proc_updated must not resurrect a cleared row.
	if (!existing) return state;
	const next: LiveProc = {
		procId,
		command: existing.command || procId,
		runId: event.runId ?? existing.runId,
		outFile: event.outFile ?? existing.outFile,
		status: 'running',
		reason: existing.reason,
		startedAt: existing.startedAt ?? Date.now(),
		outputPreview: appendProcPreview(existing.outputPreview, text)
	};
	return {
		...state,
		liveProcs: [...prev.filter(p => p.procId !== procId), next]
	};
}

export function applyBackgroundTaskCompleted(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'background_task_completed'}>
): TranscriptState {
	const procId = event.procId?.trim();
	if (!procId) return state;
	return {...state, liveProcs: (state.liveProcs ?? []).filter(p => p.procId !== procId)};
}

export function applyTaskUpdated(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'task_updated'}>
): TranscriptState {
	if (event.kind === 'proc') return state;
	if (event.kind !== 'loop' && event.kind !== 'automation') return state;
	const taskId = event.taskId?.trim();
	if (!taskId) return state;
	const prev = state.liveTasks ?? [];
	const status = event.status?.trim() || 'running';
	if (LIVE_TASK_TERMINAL.has(status.toLowerCase())) {
		return {...state, liveTasks: prev.filter(t => t.taskId !== taskId)};
	}
	const existing = prev.find(t => t.taskId === taskId);
	const detail = event.detail ?? existing?.detail;
	const next: LiveTask = {
		taskId,
		kind: event.kind,
		status,
		title: event.title ?? existing?.title,
		detail,
		nextFireAt: nextFireAtFromDetail(detail) ?? existing?.nextFireAt,
		startedAt: existing?.startedAt ?? Date.now()
	};
	return {
		...state,
		liveTasks: [...prev.filter(t => t.taskId !== taskId), next]
	};
}

export function applyChildWorkChanged(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'child_work_changed'}>
): TranscriptState {
	const id = event.id?.trim();
	if (!id) return state;
	const kind = event.kind?.trim().toLowerCase() ?? '';
	if (CHILD_WORK_COVERED_KINDS.has(kind)) return state;
	const status = event.status?.trim() || 'running';
	const terminal = CHILD_WORK_TERMINAL.has(status.toLowerCase());
	const eventGoal =
		typeof event.goalId === 'string' && event.goalId.trim()
			? event.goalId.trim()
			: undefined;
	const eventStep =
		typeof event.stepId === 'string' && event.stepId.trim()
			? event.stepId.trim()
			: undefined;
	const withCard = eventGoal
		? state
		: patchSubagentRowFromChildWork(
				state,
				id,
				terminal ? statusFromChildWork(status) : undefined,
				typeof event.outputPreview === 'string' ? event.outputPreview : undefined,
				terminal ? undefined : (event.summary ?? undefined)
			);
	const prev = withCard.childWork ?? [];
	const existing = prev.find(w => w.id === id);
	const goalId = eventGoal ?? existing?.goalId;
	const stepId = eventStep ?? existing?.stepId;
	// L1 Goal steps stay in the drawer after settle (plan B); other kinds drop.
	if (terminal && !goalId) {
		if (!prev.some(w => w.id === id)) return withCard;
		return {...withCard, childWork: prev.filter(w => w.id !== id)};
	}
	const preview =
		typeof event.outputPreview === 'string'
			? event.outputPreview
			: existing?.outputPreview;
	const next: LiveChildWork = {
		kind: kind || existing?.kind || 'run',
		id,
		parentRef: event.parentRef ?? existing?.parentRef,
		title: event.title?.trim() || existing?.title || id,
		status,
		summary: event.summary ?? existing?.summary,
		outputPreview: preview,
		...(goalId ? {goalId} : {}),
		...(stepId ? {stepId} : {}),
		startedAt: existing?.startedAt ?? Date.now()
	};
	return {...withCard, childWork: [...prev.filter(w => w.id !== id), next]};
}

export {CHILD_WORK_TERMINAL};
