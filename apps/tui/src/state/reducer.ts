import {
	applyLocalCancel,
	chromeAwaitingSettlement,
	createTranscriptState,
	runChromeTransition,
	type TranscriptEntry,
	type TranscriptState
} from '@fast-ide/session-view';
import type {BridgeEvent} from '../rpc/protocol.js';
import {pickIdList} from '@fastllm/bridge-protocol';
import type {AgentRun, FooterConfig, FooterItemId, Message, QueuedInput, Turn, UiState} from './model.js';
import {pushAgent, popAgent, switchSibling} from './agentViewStack.js';
import type {AgentViewEntry} from './agentViewStack.js';
import {applyEvent} from './applyEvent.js';

let idSeq = 0;
export function nextId(prefix: string): string {
	return `${prefix}_${Date.now()}_${++idSeq}`;
}

/** Keep previous when both next plural and singular are nullish. */
export function mergeIdList(
	prev: string[] | undefined,
	plural?: string | string[] | null,
	singular?: string | string[] | null
): string[] | undefined {
	if (plural == null && singular == null) return prev;
	return pickIdList(plural, singular);
}

/**
 * Attribute a subagent tool event to its run. agentRunId (unique per delegation)
 * is authoritative; agentId alone repeats across calls of the same agent, so it
 * only matches while that run is the sole running one.
 */
export function matchesAgentEvent(ar: AgentRun, agentRunId: string | undefined, agentId: string | undefined): boolean {
	return agentRunId ? ar.runId === agentRunId : ar.agentId === agentId && ar.status === 'running';
}

/**
 * One-line activity for the running agent row: tool name plus its key argument
 * ("shell sbt -batch compile"), so the row says WHAT is running, not just which
 * tool. Unknown arg shapes fall back to the bare tool name.
 */
const activityArgKeys = ['command', 'path', 'file_path', 'query', 'pattern', 'name', 'url'];
export function toolActivity(tool: string, args: Record<string, string>): string {
	const arg = activityArgKeys.map(key => args[key]).find(value => value && value.trim().length > 0);
	if (!arg) return tool;
	const firstLine = arg.split('\n', 1)[0] ?? '';
	const capped = firstLine.length > 40 ? `${firstLine.slice(0, 39)}…` : firstLine;
	return `${tool} ${capped}`;
}

export type UiAction =
	| {type: 'submit_user'; text: string; clientMessageId: string}
	| {type: 'submit_command'; text: string; clientMessageId: string}
	| {type: 'enqueue_input'; input: QueuedInput}
	| {type: 'dequeue_input'; id?: string}
	| {type: 'clear_queue'}
	| {type: 'clear'}
	| {type: 'clear_errors'}
	| {type: 'undo_last_exchange'}
	| {type: 'notice'; text: string}
	| {type: 'debug_note'; text: string}
	| {type: 'toggle_help'}
	| {type: 'local_cancel'}
	| {type: 'force_cancel_settlement'; reason?: string}
	| {type: 'engine_event'; event: BridgeEvent}
	| {type: 'toggle_file'; path?: string}
	| {type: 'toggle_tool_detail'}
	| {type: 'error'; message: string}
	| {type: 'set_footer_config'; config: FooterConfig}
	| {type: 'toggle_footer_item'; id: FooterItemId}
	| {type: 'cycle_thinking_display'}
	| {type: 'toggle_debug'; visible?: boolean}
	| {type: 'set_debug_url'; url?: string}
	| {type: 'approval_decision_sent'; id: string; value: 'y' | 'n' | 'a'; at: number}
	| {type: 'approval_decision_failed'; id: string; reason: string}
	| {type: 'engine_exit'; code: number | null; signal: NodeJS.Signals | null}
	| {type: 'agent_view_push'; entry: AgentViewEntry}
	| {type: 'agent_view_pop'}
	| {type: 'agent_view_sibling'; direction: 'prev' | 'next'}
	| {type: 'collapse_command_menus'}
	| {type: 'rerun_started'; runId: string}
	| {type: 'dismiss_goal_card'}
	| {type: 'toggle_goal_card_focus'}
	| {type: 'blur_goal_card'};

const FAULT_KIND_TEXT: Record<string, string> = {
	silent: '响应为空或格式错误',
	interrupted: '运行被中断',
	declined: '请求被拒绝',
	availability: '模型暂时不可用',
	unusable: '模型输出不可用'
};

const FAULT_REMEDY_TEXT: Record<string, string> = {
	retry_same: '以相同设置重试',
	retry_other: '切换模型后重试',
	fail: '无法自动恢复，请开启新的运行'
};

export function faultHeadline(fault?: {kind: string; remedy?: string}): string {
	if (!fault) return '运行失败';
	const kind = FAULT_KIND_TEXT[fault.kind] ?? fault.kind;
	const remedy = fault.remedy ? (FAULT_REMEDY_TEXT[fault.remedy] ?? fault.remedy) : undefined;
	return remedy ? `运行失败：${kind}（${remedy}）` : `运行失败：${kind}`;
}

/** Map a RerunRun rejection detail to a localized sentence; unknown detail passes through. */
export function rerunRejectionText(message?: string): string {
	const detail = (message ?? '').trim();
	if (detail.includes('session_busy')) return '重跑被拒绝：会话正忙 — 请等待当前运行结束后再重试。';
	if (detail.includes('rerun_target_stale')) return '重跑被拒绝：该结果已过期 — 只能重跑最近一次运行。';
	if (detail.includes('rerun_unsupported')) return '重跑被拒绝：当前引擎不支持重跑。';
	return detail ? `重跑被拒绝：${detail}` : '重跑请求被拒绝。';
}

export function reducer(state: UiState, action: UiAction): UiState {
	switch (action.type) {
		case 'submit_user': {
			const transcript = seedOptimisticTurn(state.transcript, action.text, action.clientMessageId);
			return {
				...state,
				...stampEntryStreamSeq(state, transcript),
				running: true,
				queuePaused: false,
				lastTurnTerminal: null,
				inputMode: state.ready ? 'running' : 'starting',
				helpVisible: false,
				localTurns: collapseCommandMenus(state.localTurns)
			};
		}
		case 'submit_command': {
			const seq = state.nextStreamSeq;
			return {
				...state,
				nextStreamSeq: seq + 1,
				helpVisible: false,
				localTurns: [
					...collapseCommandMenus(state.localTurns),
					{
						id: action.clientMessageId,
						clientMessageId: action.clientMessageId,
						userText: action.text,
						thinking: '',
						assistantText: '',
						tools: [],
						files: [],
						systemMessages: [],
						segments: [],
						status: 'success',
						tokensUsed: 0,
						streamSeq: seq
					}
				]
			};
		}
		case 'collapse_command_menus':
			return {...state, localTurns: collapseCommandMenus(state.localTurns)};
		case 'rerun_started':
			return {...state, rerunPendingRunId: action.runId};
		case 'dismiss_goal_card':
			return {...state, goalCard: undefined, goalCardFocused: false};
		case 'toggle_goal_card_focus':
			return state.goalCard ? {...state, goalCardFocused: !state.goalCardFocused} : state;
		case 'blur_goal_card':
			return {...state, goalCardFocused: false};
		case 'enqueue_input':
			return {
				...state,
				queue: [...state.queue, action.input],
				inputMode: 'queued',
				status: state.running ? 'queued' : state.status
			};
		case 'dequeue_input':
			if (action.id) {
				return {...state, queue: state.queue.filter(input => input.id !== action.id)};
			}
			return {
				...state,
				queue: state.queue.slice(1)
			};
		case 'clear_queue':
			return {...state, queue: []};
		case 'clear':
			return {
				...state,
				transcript: {
					...createTranscriptState(),
					chrome: runChromeTransition(state.transcript.chrome, {
						run: 'clear',
						postRun: true,
						awaiting: false
					})
				},
				localTurns: [],
				nextStreamSeq: 0,
				entryStreamSeq: {},
				approvalDecisions: {},
				orphanEvents: [],
				debugEvents: [],
				llmRequests: [],
				errors: [],
				queue: [],
				helpVisible: false,
				inputMode: state.ready ? 'normal' : 'starting',
				status: state.ready ? 'ready' : state.status
			};
		case 'clear_errors':
			return {...state, errors: []};
		case 'undo_last_exchange':
			return {
				...state,
				transcript: undoLastExchange(state.transcript),
				localTurns: state.localTurns.length > 0 && state.transcript.entries.length === 0
					? state.localTurns.slice(0, -1)
					: state.localTurns,
				status: 'undo'
			};
		case 'notice':
			return pushLocalSystem(state, {id: nextId('system'), role: 'system', text: action.text});
		case 'debug_note':
			// Diagnostics that must NOT enter the transcript: appending a system
			// message mutates the last turn's settled items — during a drift
			// repaint that feedback loop caused notice → new item → next drift.
			return appendDebugEvent(state, action.text);
		case 'toggle_help':
			return {...state, helpVisible: !state.helpVisible};
		case 'local_cancel':
			return {
				...state,
				transcript: applyLocalCancel(state.transcript),
				// Stopping: keep running flag until turn_cancelled; Composer Gate allows enqueue.
				running: true,
				queuePaused: true,
				inputMode: 'running',
				status: 'cancelling',
				agentRuns: [],
				approvalDecisions: {}
			};
		case 'force_cancel_settlement':
			// Last-resort unlock when Bridge never emits turn_cancelled (ADR-0007 watchdog).
			if (!chromeAwaitingSettlement(state.transcript.chrome)) return state;
			return {
				...state,
				transcript: {
					...state.transcript,
					chrome: runChromeTransition(state.transcript.chrome, {awaiting: 'clear', postRun: true}),
					approvals: [],
					questions: []
				},
				running: false,
				lastTurnTerminal: 'cancelled',
				queuePaused: true,
				inputMode: state.queue.length > 0 ? 'queued' : 'normal',
				status: 'cancelled',
				approvalDecisions: {},
				agentRuns: []
			};
		case 'toggle_file':
			// Bridge file_read is a tool in transcript; expand via toolsExpanded.
			return {...state, toolsExpanded: !state.toolsExpanded};
		case 'toggle_tool_detail':
			return {...state, toolsExpanded: !state.toolsExpanded};
		case 'error':
			return {...state, errors: [...state.errors, action.message], status: 'error', inputMode: state.ready ? 'normal' : 'starting'};
		case 'cycle_thinking_display': {
			const order: UiState['thinkingDisplay'][] = ['compact', 'full', 'off'];
			const next = order[(order.indexOf(state.thinkingDisplay) + 1) % order.length] ?? 'compact';
			const label = next === 'compact' ? 'compact (collapse after done)' : next === 'full' ? 'full (always show)' : 'off (hide reasoning)';
			return {
				...pushLocalSystem(state, {id: nextId('system'), role: 'system', text: `Thinking display: ${label}`}),
				thinkingDisplay: next
			};
		}
		case 'set_footer_config':
			return {...state, footerConfig: action.config};
		case 'toggle_footer_item':
			return {
				...state,
				footerConfig: {
					...state.footerConfig,
					[action.id]: !state.footerConfig[action.id]
				}
			};
		case 'toggle_debug': {
			const visible = action.visible ?? !state.debugVisible;
			return {...state, debugVisible: visible, debugUrl: visible ? state.debugUrl : undefined};
		}
		case 'set_debug_url':
			return {...state, debugUrl: action.url};
		case 'approval_decision_sent':
			return {
				...state,
				approvalDecisions: {
					...state.approvalDecisions,
					[action.id]: {value: action.value, sentAt: action.at}
				}
			};
		case 'approval_decision_failed': {
			const existing = state.approvalDecisions[action.id];
			if (!existing) return state;
			return {
				...state,
				approvalDecisions: {
					...state.approvalDecisions,
					[action.id]: {...existing, failed: action.reason}
				}
			};
		}
		case 'engine_exit':
			return {...state, running: false, inputMode: 'exited', status: `engine exited ${action.code ?? action.signal ?? ''}`.trim()};
		case 'agent_view_push':
			return {...state, agentViewStack: pushAgent(state.agentViewStack, action.entry)};
		case 'agent_view_pop':
			return {...state, agentViewStack: popAgent(state.agentViewStack)};
		case 'agent_view_sibling':
			return {...state, agentViewStack: switchSibling(state.agentViewStack, action.direction)};
		case 'engine_event':
			return appendDebugEvent(
				{...applyEvent(state, action.event), lastEngineEventAt: Date.now()},
				action.event.type
			);
	}
}

function seedOptimisticTurn(transcript: TranscriptState, text: string, clientMessageId: string): TranscriptState {
	return {
		...transcript,
		chrome: runChromeTransition(transcript.chrome, {postRun: false, awaiting: 'clear'}),
		entries: [
			...transcript.entries,
			{
				id: `user-${clientMessageId}`,
				role: 'user',
				text,
				status: 'done',
				turnId: clientMessageId,
				clientMessageId
			},
			{
				id: `assistant-${clientMessageId}`,
				role: 'assistant',
				text: '',
				reasoning: '',
				status: 'streaming',
				turnId: clientMessageId,
				clientMessageId,
				tools: [],
				segments: []
			}
		]
	};
}

export function markClientRejected(transcript: TranscriptState, clientMessageId: string): TranscriptState {
	return {
		...transcript,
		entries: transcript.entries.map(entry =>
			entry.clientMessageId === clientMessageId || entry.turnId === clientMessageId
				? {...entry, status: entry.role === 'assistant' ? 'error' : entry.status}
				: entry
		)
	};
}

function undoLastExchange(transcript: TranscriptState): TranscriptState {
	const entries = [...transcript.entries];
	if (entries.length === 0) return transcript;
	const last = entries.at(-1);
	if (last?.role === 'assistant') {
		entries.pop();
		const prev = entries.at(-1);
		if (prev?.role === 'user' && (prev.turnId === last.turnId || prev.clientMessageId === last.clientMessageId)) {
			entries.pop();
		}
	} else {
		entries.pop();
	}
	return {...transcript, entries};
}

export function promptInputMode(state: UiState, fallback: UiState['inputMode']): UiState['inputMode'] {
	if (state.transcript.approvals.length > 0) return 'approval';
	if (state.transcript.questions.length > 0) return 'question';
	return fallback;
}

export function omitDecision(
	decisions: UiState['approvalDecisions'],
	id: string
): UiState['approvalDecisions'] {
	if (!(id in decisions)) return decisions;
	const next = {...decisions};
	delete next[id];
	return next;
}

/**
 * Track agent names registered via define_agent / removed via delete_agent, so
 * Ctrl+G can say "defined but not yet called" instead of a misleading "none".
 */
export function trackDefinedAgents(state: UiState, tool: string, toolId: string, success: boolean): UiState {
	if (!success || (tool !== 'define_agent' && tool !== 'delete_agent')) return state;
	const name = state.transcript.entries
		.flatMap(entry => entry.tools ?? [])
		.find(run => run.id === toolId)?.args?.name;
	if (!name) return state;
	const defined = tool === 'define_agent'
		? state.definedAgents.includes(name) ? state.definedAgents : [...state.definedAgents, name]
		: state.definedAgents.filter(existing => existing !== name);
	return defined === state.definedAgents ? state : {...state, definedAgents: defined};
}

export function appendDebugEvent(state: UiState, eventType: string): UiState {
	return {...state, debugEvents: [...state.debugEvents.slice(-99), `${new Date().toISOString()} ${eventType}`]};
}

function pushSystem(turn: Turn, message: Message): Turn {
	return {
		...turn,
		systemMessages: [...turn.systemMessages, message],
		segments: [...turn.segments, {kind: 'system', id: `seg-${message.id}`, messageId: message.id}]
	};
}

/** Extract `key=value` from an engine detail string like `status=Running;decision=applied`. */
export function detailField(message: string, key: string): string | undefined {
	const match = message.match(new RegExp(`(?:^|[;\\s])${key}=([^;\\s]+)`));
	return match?.[1];
}

export function isRepeatedCommandResult(turns: Turn[], name: string, text: string, status: string): boolean {
	const last = turns.at(-1);
	const lastMessage = last?.systemMessages.at(-1);
	if (!last || !lastMessage || lastMessage.kind !== 'command_result') return false;
	const lastSegment = last.segments.at(-1);
	if (lastSegment?.kind !== 'system' || lastSegment.messageId !== lastMessage.id) return false;
	return lastMessage.commandName === name && lastMessage.text === text && lastMessage.commandStatus === status;
}

/** True when the latest local turn is the matching `/name` slash waiting for its result. */
export function canAttachCommandResult(turns: Turn[], name: string | undefined): boolean {
	if (!name) return false;
	const last = turns.at(-1);
	if (!last) return false;
	if (last.systemMessages.some(m => m.kind === 'command_result')) return false;
	const slash = `/${name}`.toLowerCase();
	const user = last.userText.trim().toLowerCase();
	return user === slash || user.startsWith(`${slash} `);
}

/** Fold prior interactive command menus (/skills list) when the user continues. */
export function collapseCommandMenus(turns: Turn[]): Turn[] {
	return turns.map(turn => {
		let changed = false;
		const systemMessages = turn.systemMessages.map(msg => {
			if (msg.kind !== 'command_result' || msg.collapsed) return msg;
			const detailLines = msg.text.split(/\r?\n/).filter(line => line.trim().length > 0).length;
			if (detailLines <= 1) return msg;
			changed = true;
			return {...msg, collapsed: true};
		});
		return changed ? {...turn, systemMessages} : turn;
	});
}

function isActiveLocalTurn(turn: Turn | undefined): boolean {
	return turn?.status === 'running' || turn?.status === 'pending' || turn?.status === 'clarify';
}

/** Assign streamSeq to newly appeared transcript entries (chronological merge key). */
export function stampEntryStreamSeq(
	state: Pick<UiState, 'nextStreamSeq' | 'entryStreamSeq'>,
	transcript: TranscriptState
): Pick<UiState, 'transcript' | 'nextStreamSeq' | 'entryStreamSeq'> {
	let seq = state.nextStreamSeq;
	const map = {...state.entryStreamSeq};
	for (const entry of transcript.entries) {
		if (map[entry.id] === undefined) {
			map[entry.id] = seq++;
		}
	}
	return {transcript, nextStreamSeq: seq, entryStreamSeq: map};
}

/** Append a system/command card; new local turns get a fresh streamSeq. */
export function pushLocalSystem(state: UiState, message: Message, status?: Turn['status']): UiState {
	if (state.localTurns.length === 0) {
		const seq = state.nextStreamSeq;
		return {
			...state,
			nextStreamSeq: seq + 1,
			localTurns: appendSystemMessage([], message, status, seq)
		};
	}
	return {...state, localTurns: appendSystemMessage(state.localTurns, message, status)};
}

export function appendSystemMessage(
	turns: Turn[],
	message: Message,
	status?: Turn['status'],
	streamSeq = 0
): Turn[] {
	if (turns.length === 0) {
		return [{
			id: message.id,
			userText: '',
			thinking: '',
			assistantText: '',
			tools: [],
			files: [],
			systemMessages: [message],
			segments: [{kind: 'system', id: `seg-${message.id}`, messageId: message.id}],
			status: status ?? 'success',
			tokensUsed: 0,
			streamSeq
		}];
	}

	const keepsStatus = (turn: Turn) => isActiveLocalTurn(turn) || turn.status === 'cancelled';
	return turns.map((turn, index) =>
		index === turns.length - 1
			? {...pushSystem(turn, message), status: keepsStatus(turn) ? turn.status : status ?? turn.status}
			: turn
	);
}

/** @deprecated kept for tests that inspect entry pairs — prefer transcript.entries */
export type {TranscriptEntry};
