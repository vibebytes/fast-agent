import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {normalizeToolOutput, parseExitCode, resolveToolStatus} from '../toolOutput.js';
import {sameRunId} from '../turnIdentity.js';
import {CHILD_WORK_TERMINAL, patchSubagentRowFromChildWork} from './drawers.js';
import {patchAssistant, pushToolSegment} from './entry.js';
import type {GoalFlowMember, ToolCallView, TranscriptEntry, TranscriptState} from './state.js';

export function eventGoalId(event: BridgeEvent): string | undefined {
	if (!('goalId' in event) || typeof event.goalId !== 'string') return undefined;
	const id = event.goalId.trim();
	return id || undefined;
}

export function subagentRunIdOf(event: {agentRunId?: string | null}): string | undefined {
	const id = typeof event.agentRunId === 'string' ? event.agentRunId.trim() : '';
	return id || undefined;
}

/** Stamped child-run finish/output may settle an existing parent row; never create one. */
function settleParentTool(
	state: TranscriptState,
	event: {turnId?: string; id: string; agentRunId?: string | null},
	update: (entry: TranscriptEntry) => TranscriptEntry
): TranscriptState {
	return patchAssistant(state, event.turnId, entry => {
		if (subagentRunIdOf(event) && !(entry.tools ?? []).some(t => t.id === event.id)) return entry;
		return update(entry);
	});
}

function upsertGoalFlowMember(
	state: TranscriptState,
	member: {
		goalId: string;
		runId: string;
		name: string;
		stepId?: string;
		status: GoalFlowMember['status'];
	}
): TranscriptState {
	const prev =
		state.goalFlow?.goalId === member.goalId
			? state.goalFlow
			: {goalId: member.goalId, members: [] as GoalFlowMember[]};
	const others = prev.members.filter(m => !sameRunId(m.runId, member.runId));
	const prior = prev.members.find(m => sameRunId(m.runId, member.runId));
	const next: GoalFlowMember = {
		runId: member.runId,
		name: member.name || prior?.name || member.runId,
		status: member.status,
		...(member.stepId || prior?.stepId
			? {stepId: member.stepId ?? prior?.stepId}
			: {})
	};
	return {...state, goalFlow: {goalId: member.goalId, members: [...others, next]}};
}

export function applyDshToolCard(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'dsh_tool_card'}>
): TranscriptState {
	const card = {
		name: event.name,
		title: event.title,
		args: event.args,
		...(event.result ? {result: event.result} : {})
	};
	return patchAssistant(state, event.runId, entry => {
		const tools = entry.tools ?? [];
		if (tools.some(t => t.id === event.callId)) {
			return {
				...entry,
				tools: tools.map(t =>
					t.id === event.callId ? {...t, dshCard: card, args: event.args, tool: event.name} : t
				)
			};
		}
		const tool: ToolCallView = {
			id: event.callId,
			tool: event.name,
			args: event.args,
			status: 'running',
			output: '',
			dshCard: card
		};
		return {...pushToolSegment(entry, tool), status: 'streaming'};
	});
}

export function applyToolStarted(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'tool_started'}>
): TranscriptState {
	if (subagentRunIdOf(event)) return state;
	const tool: ToolCallView = {
		id: event.id,
		tool: event.tool,
		args: event.args,
		status: 'running',
		output: '',
		startedAt: Date.now()
	};
	return patchAssistant(state, event.turnId, entry => ({
		...pushToolSegment(entry, tool),
		status: 'streaming'
	}));
}

export function applyToolOutput(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'tool_output'}>
): TranscriptState {
	return settleParentTool(state, event, entry => ({
		...entry,
		tools: (entry.tools ?? []).map(t =>
			t.id === event.id
				? {...t, output: `${t.output ?? ''}${event.text}`}
				: t
		)
	}));
}

export function applyToolFinished(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'tool_finished'}>
): TranscriptState {
	return settleParentTool(state, event, entry => ({
		...entry,
		tools: (entry.tools ?? []).map(t => {
			if (t.id !== event.id) return t;
			const fields = event.fields ?? {};
			const raw =
				t.output ||
				fields.diff ||
				fields.patch ||
				fields.output ||
				fields.message ||
				fields.error ||
				t.output ||
				'';
			let output = normalizeToolOutput(raw);
			const mediaPath = (fields.path ?? fields.output_path ?? '').trim();
			if (
				mediaPath &&
				/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(mediaPath) &&
				!output.includes(mediaPath)
			) {
				output = output ? `${output}\npath: ${mediaPath}` : `path: ${mediaPath}`;
			}
			const exit = parseExitCode(fields, raw);
			return {
				...t,
				fields,
				exitCode: exit !== undefined ? String(exit) : fields.exit ?? fields.exit_code,
				status: resolveToolStatus({
					eventSuccess: event.success,
					fields,
					raw,
					fallback: t.status
				}),
				output
			};
		})
	}));
}

export function applyAgentCallStarted(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'agent_call_started'}>
): TranscriptState {
	const runId = event.runId ?? '';
	const goalId = eventGoalId(event);
	if (goalId) {
		return upsertGoalFlowMember(state, {
			goalId,
			runId: runId || event.agentId,
			name: event.name,
			stepId: typeof event.stepId === 'string' ? event.stepId : undefined,
			status: 'running'
		});
	}
	const label = `agent: ${event.name}`;
	const withRow = patchAssistant(state, event.turnId, entry => {
		const tools = entry.tools ?? [];
		if (runId && tools.some(t => sameRunId(t.agentRunId, runId))) return entry;
		const host = [...tools]
			.reverse()
			.find(t => t.status === 'running' && t.tool === label && !t.agentRunId);
		if (host && runId) {
			return {
				...entry,
				tools: tools.map(t => (t === host ? {...t, agentRunId: runId} : t))
			};
		}
		const next = pushToolSegment(entry, {
			id: `agent-run-${runId || `${event.agentId}-${tools.length}`}`,
			tool: label,
			args: {name: event.name},
			status: 'running',
			output: '',
			startedAt: Date.now(),
			...(runId ? {agentRunId: runId} : {})
		});
		return entry.status === 'streaming' ? {...next, status: 'streaming'} : next;
	});
	if (!runId) return withRow;
	const live = (withRow.childWork ?? []).find(
		w => sameRunId(w.id, runId) && !CHILD_WORK_TERMINAL.has(w.status.toLowerCase())
	);
	if (!live) return withRow;
	return patchSubagentRowFromChildWork(
		withRow,
		live.id,
		undefined,
		live.outputPreview,
		live.summary
	);
}

export function applyAgentCallFinished(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'agent_call_finished'}>
): TranscriptState {
	const runId = event.runId ?? '';
	const goalId = eventGoalId(event);
	if (goalId) {
		const prev = state.goalFlow?.members.find(m => sameRunId(m.runId, runId || event.agentId));
		const incoming: GoalFlowMember['status'] = event.success ? 'success' : 'error';
		const status =
			prev?.status === 'success' && incoming === 'error' ? 'success' : incoming;
		return upsertGoalFlowMember(state, {
			goalId,
			runId: runId || event.agentId,
			name: prev?.name || runId || event.agentId,
			stepId:
				(typeof event.stepId === 'string' ? event.stepId : undefined) ?? prev?.stepId,
			status
		});
	}
	return patchAssistant(state, event.turnId, entry => ({
		...entry,
		tools: (entry.tools ?? []).map(t => {
			const matches = runId
				? sameRunId(t.agentRunId, runId)
				: t.status === 'running' && t.tool.startsWith('agent: ');
			if (!matches || t.status !== 'running') return t;
			const summary =
				(event.resultSummary ?? '').trim() || (event.detail ?? '').trim();
			return {
				...t,
				status: event.success ? 'success' : 'error',
				output: summary || t.output
			};
		})
	}));
}

export function applyFileRead(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'file_read'}>
): TranscriptState {
	return patchAssistant(state, event.turnId, entry =>
		pushToolSegment(entry, {
			id: `file-read-${event.path}-${(entry.tools ?? []).length}`,
			tool: 'file_read',
			args: {path: event.path, language: event.language},
			output: event.content.slice(0, 2000),
			status: 'success'
		})
	);
}
