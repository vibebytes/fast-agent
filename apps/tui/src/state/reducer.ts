import {
	applyBridgeEvent,
	applyLocalCancel,
	createTranscriptState,
	type TranscriptEntry,
	type TranscriptState
} from '@fast-ide/session-view';
import type {BridgeEvent} from '../rpc/protocol.js';
import {isSilentCommandResult} from '../rpc/hostProtocolCommands.js';
import {pickIdList} from '@fastllm/bridge-protocol';
import type {AgentRun, FooterConfig, FooterItemId, GoalCardState, Message, QueuedInput, Turn, UiState} from './model.js';
import {pushAgent, popAgent, switchSibling} from './agentViewStack.js';
import type {AgentViewEntry} from './agentViewStack.js';

let idSeq = 0;
function nextId(prefix: string): string {
	return `${prefix}_${Date.now()}_${++idSeq}`;
}

/** Keep previous when both next plural and singular are nullish. */
function mergeIdList(
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
function matchesAgentEvent(ar: AgentRun, agentRunId: string | undefined, agentId: string | undefined): boolean {
	return agentRunId ? ar.runId === agentRunId : ar.agentId === agentId && ar.status === 'running';
}

/**
 * One-line activity for the running agent row: tool name plus its key argument
 * ("shell sbt -batch compile"), so the row says WHAT is running, not just which
 * tool. Unknown arg shapes fall back to the bare tool name.
 */
const activityArgKeys = ['command', 'path', 'file_path', 'query', 'pattern', 'name', 'url'];
function toolActivity(tool: string, args: Record<string, string>): string {
	const arg = activityArgKeys.map(key => args[key]).find(value => value && value.trim().length > 0);
	if (!arg) return tool;
	const firstLine = arg.split('\n', 1)[0] ?? '';
	const capped = firstLine.length > 40 ? `${firstLine.slice(0, 39)}…` : firstLine;
	return `${tool} ${capped}`;
}

/** Events whose Transcript projection is owned by session-view applyBridgeEvent. */
const BRIDGE_TRANSCRIPT_EVENTS = new Set([
	'turn_started',
	'input_accepted',
	'session_restored',
	'session_history_page',
	'reasoning_delta',
	'assistant_delta',
	'final_answer',
	'turn_finished',
	'turn_cancelled',
	'error',
	'tool_started',
	'tool_output',
	'tool_finished',
	'file_read',
	'approval_requested',
	'approval_resolved',
	'approval_expired',
	'question_requested',
	'question_answered',
	'clarify_resolved',
	'clarify',
	'run_cancelled',
	'run_done',
	'run_failed',
	'run_exhausted',
	'llm_network_wait'
]);

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

function faultHeadline(fault?: {kind: string; remedy?: string}): string {
	if (!fault) return '运行失败';
	const kind = FAULT_KIND_TEXT[fault.kind] ?? fault.kind;
	const remedy = fault.remedy ? (FAULT_REMEDY_TEXT[fault.remedy] ?? fault.remedy) : undefined;
	return remedy ? `运行失败：${kind}（${remedy}）` : `运行失败：${kind}`;
}

/** Map a RerunRun rejection detail to a localized sentence; unknown detail passes through. */
function rerunRejectionText(message?: string): string {
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
				transcript: createTranscriptState(),
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
			if (!state.transcript.awaitingCancelSettlement) return state;
			return {
				...state,
				transcript: {
					...state.transcript,
					awaitingCancelSettlement: false,
					postRunTerminal: true,
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

function applyEvent(state: UiState, event: BridgeEvent): UiState {
	const withTranscript = BRIDGE_TRANSCRIPT_EVENTS.has(event.type)
		? {...state, ...stampEntryStreamSeq(state, applyBridgeEvent(state.transcript, event))}
		: state;

	switch (event.type) {
		case 'ready': {
			const epochChanged = event.engineEpoch !== undefined
				&& state.engineEpoch !== undefined
				&& event.engineEpoch !== state.engineEpoch;
			const hadPendingInteractions =
				state.transcript.approvals.length > 0
				|| state.transcript.questions.length > 0;
			const base =
				epochChanged && hadPendingInteractions
					? pushLocalSystem(withTranscript, {
						id: nextId('system'),
						role: 'system',
						text: '引擎已重启，等待中的审批/提问已失效，请重新发起。'
					})
					: withTranscript;
			return {
				...base,
				ready: true,
				running: false,
				status: 'ready',
				inputMode: 'normal',
				transcript: {
					...base.transcript,
					approvals: [],
					questions: epochChanged ? [] : base.transcript.questions
				},
				approvalDecisions: {},
				engineEpoch: event.engineEpoch ?? state.engineEpoch,
				protocolVersion: event.protocolVersion ?? state.protocolVersion,
				capabilities: event.capabilities ?? state.capabilities,
				model: event.model ?? state.model,
				modelDisplay: event.modelDisplay ?? event.model ?? state.modelDisplay,
				maxTurns: event.maxTurns ?? state.maxTurns,
				standalone: event.standalone ?? state.standalone,
				cwd: event.cwd ?? state.cwd,
				bridgeMode: event.mode ?? state.bridgeMode,
				sessionId: event.sessionId ?? state.sessionId,
				sessionTitle: event.sessionTitle ?? state.sessionTitle,
				adminUrl: event.adminUrl ?? state.adminUrl
			};
		}
		case 'Attached':
			return {
				...withTranscript,
				sessionId: event.sessionId,
				status: `attached ${event.sessionId.slice(0, 8)}`
			};
		case 'Ack':
			return {...withTranscript, status: `ack ${event.lastEventSeq}`};
		case 'Heartbeat':
			return {...withTranscript, status: 'heartbeat'};
		case 'session_restored': {
			const hasStreaming = withTranscript.transcript.entries.some(
				e => e.role === 'assistant' && e.status === 'streaming'
			);
			return {
				...withTranscript,
				sessionId: event.sessionId,
				running: hasStreaming ? state.running : false,
				inputMode: hasStreaming ? state.inputMode : 'normal',
				rerunPendingRunId:
					state.rerunPendingRunId && event.turns.some(t => t.supersedes === state.rerunPendingRunId)
						? null
						: state.rerunPendingRunId
			};
		}
		case 'sessions_list':
			return {...withTranscript, sessions: event.sessions.map(s => ({
				id: s.id,
				lastModified: s.lastModified,
				messageCount: s.messageCount,
				title: s.title ?? undefined,
				summary: s.summary ?? undefined,
				cwd: s.cwd ?? undefined,
				isCurrent: s.isCurrent ?? undefined
			}))};
		case 'engine_status':
			if (event.stage === 'admin_ready' && event.message) {
				return {...withTranscript, status: event.stage, adminUrl: event.message};
			}
			return {...withTranscript, status: event.stage};
		case 'llm_request':
			return {
				...withTranscript,
				llmRequests: [
					...state.llmRequests.slice(-19),
					{
						id: `llm_${Date.now()}_${state.llmRequests.length}`,
						turn: event.turn ?? 1,
						at: new Date().toISOString(),
						messages: event.messages,
						response: {reasoning: '', content: ''}
					}
				]
			};
		case 'llm_response': {
			if (state.llmRequests.length === 0) return withTranscript;
			const last = state.llmRequests[state.llmRequests.length - 1]!;
			const updated = {...last, response: {reasoning: event.reasoning ?? '', content: event.content ?? ''}};
			return {...withTranscript, llmRequests: [...state.llmRequests.slice(0, -1), updated]};
		}
		case 'input_accepted':
			return {
				...withTranscript,
				// Peer (IDE) accept must fold open /skills menus — local submit already collapses.
				localTurns: collapseCommandMenus(withTranscript.localTurns),
				status: 'accepted',
				running: true,
				inputMode: 'running'
			};
		case 'input_rejected': {
			const alreadyRunning = /turn is already running/i.test(event.reason);
			const rejectedId = event.clientMessageId;
			// Peer turn still streaming: our concurrent submit bounced — keep gate in enqueue mode.
			const peerStillLive = withTranscript.transcript.entries.some(e =>
				e.status === 'streaming'
				&& (!rejectedId
					|| (e.clientMessageId !== rejectedId && e.turnId !== rejectedId))
			);
			if (alreadyRunning && peerStillLive) {
				return {
					...withTranscript,
					running: true,
					inputMode: 'running',
					status: 'rejected',
					transcript: rejectedId
						? markClientRejected(withTranscript.transcript, rejectedId)
						: withTranscript.transcript
				};
			}
			return {
				...withTranscript,
				running: false,
				inputMode: state.ready ? 'normal' : 'starting',
				errors: [...state.errors, event.reason],
				transcript: rejectedId
					? markClientRejected(withTranscript.transcript, rejectedId)
					: withTranscript.transcript,
				status: 'rejected'
			};
		}
		case 'turn_started':
			return {
				...withTranscript,
				localTurns: collapseCommandMenus(withTranscript.localTurns),
				running: true,
				inputMode: 'running',
				status: 'running',
				lastTurnTerminal: null
			};
		case 'thinking_started':
			return {...withTranscript, status: `thinking ${event.turn}/${event.maxTurns}`};
		case 'reasoning_delta':
		case 'assistant_delta':
		case 'final_answer':
		case 'tool_started':
		case 'tool_output':
		case 'tool_finished':
		case 'file_read': {
			let next = withTranscript;
			if (event.type === 'tool_started' && event.agentId) {
				next = {
					...next,
					agentRuns: next.agentRuns.map(ar =>
						matchesAgentEvent(ar, event.agentRunId, event.agentId)
							? {...ar, currentTool: toolActivity(event.tool, event.args)}
							: ar)
				};
			}
			if (event.type === 'tool_finished') {
				if (event.agentId) {
					next = {
						...next,
						agentRuns: next.agentRuns.map(ar =>
							matchesAgentEvent(ar, event.agentRunId, event.agentId)
								? {...ar, toolCalls: ar.toolCalls + 1, currentTool: undefined}
								: ar)
					};
				}
				next = trackDefinedAgents(next, event.tool, event.id, event.success);
			}
			// Homeless stream events: session-view drops them (no ghost turns).
			if (
				BRIDGE_TRANSCRIPT_EVENTS.has(event.type)
				&& next.transcript === state.transcript
				&& (event.type === 'reasoning_delta'
					|| event.type === 'assistant_delta'
					|| event.type === 'final_answer'
					|| event.type === 'tool_started'
					|| event.type === 'tool_output'
					|| event.type === 'tool_finished'
					|| event.type === 'file_read')
			) {
				const turnId = 'turnId' in event ? event.turnId : undefined;
				return {...next, orphanEvents: [...next.orphanEvents, turnId ?? 'missing-turn']};
			}
			return next;
		}
		case 'turn_usage':
			return {
				...withTranscript,
				status: `turn ${event.turn}, ${event.tokensUsed} tokens`,
				tokensUsed: state.tokensUsed + event.tokensUsed
			};
		case 'turn_finished':
			return {
				...withTranscript,
				running: false,
				lastTurnTerminal: 'finished',
				inputMode: promptInputMode(withTranscript, state.queue.length > 0 ? 'queued' : 'normal'),
				status: event.success ? 'ready' : 'failed',
				approvalDecisions: {}
			};
		case 'turn_cancelled':
			return {
				...withTranscript,
				running: false,
				lastTurnTerminal: 'cancelled',
				inputMode: state.queue.length > 0 ? 'queued' : 'normal',
				status: 'cancelled',
				approvalDecisions: {},
				agentRuns: []
			};
		case 'approval_requested':
			return {...withTranscript, inputMode: 'approval'};
		case 'approval_resolved':
			return {
				...withTranscript,
				approvalDecisions: omitDecision(state.approvalDecisions, event.id),
				inputMode: state.running ? 'running' : 'normal'
			};
		case 'approval_expired': {
			if (!state.transcript.approvals.some(approval => approval.id === event.id)) {
				return withTranscript;
			}
			const reasonText = event.reason === 'engine_restart' ? '引擎已重启' : event.reason ?? '已过期';
			return {
				...pushLocalSystem(withTranscript, {
					id: nextId('system'),
					role: 'system',
					text: `审批已失效（${reasonText}），请重新发起。`
				}),
				approvalDecisions: omitDecision(state.approvalDecisions, event.id),
				inputMode: withTranscript.transcript.approvals.length > 0
					? 'approval'
					: state.running ? 'running' : 'normal'
			};
		}
		case 'command_result': {
			// RerunRun feedback is localized here (doc §8): rejections render a
			// localized card and retire the optimistic hide; acceptances stay
			// silent — the replayed turn's lifecycle events are the feedback.
			if (event.name === 'RerunRun') {
				if (event.status === 'error' || event.status === 'rejected') {
					return appendDebugEvent(
						{
							...pushLocalSystem(withTranscript, {
								id: nextId('system'),
								role: 'system',
								text: rerunRejectionText(event.message)
							}),
							rerunPendingRunId: null,
							status: 'rerun rejected'
						},
						`command_result RerunRun ${event.status}`
					);
				}
				return appendDebugEvent(
					{...withTranscript, status: 'rerun accepted'},
					`command_result RerunRun ${event.status ?? 'accepted'}`
				);
			}
			// Follow-up ACK while a turn is already running — queue UX is local;
			// do not dump "followUpId=..." into the transcript.
			if (event.name === 'SubmitUserMessage' && (event.status === 'queued' || event.status === 'steered')) {
				return {
					...withTranscript,
					status: event.status,
					inputMode: event.status === 'queued' && state.running ? 'queued' : state.inputMode
				};
			}
			// DecideApproval ACKs route to the approval state machine, never to
			// the transcript — repeated "decided status=..." cards were the
			// visible half of the zombie-approval bug.
			if (event.name === 'DecideApproval') {
				const decisionTag = detailField(event.message, 'decision');
				const failedReason = event.status === 'error'
					? event.message
					: decisionTag !== undefined && decisionTag !== 'applied' && decisionTag !== 'already_decided'
						? `引擎未接受该审批决定（${decisionTag}）`
						: undefined;
				const decisions = {...state.approvalDecisions};
				for (const [id, decision] of Object.entries(decisions)) {
					if (!decision.acked && !decision.failed) {
						decisions[id] = {
							...decision,
							acked: true,
							...(failedReason ? {failed: failedReason} : {})
						};
					}
				}
				return appendDebugEvent(
					{
						...withTranscript,
						approvalDecisions: decisions,
						status: `decide ${decisionTag ?? event.status ?? 'acked'}`
					},
					`command_result DecideApproval ${event.status ?? 'acked'}`
				);
			}
			let clearedPending = withTranscript;
			// ConfirmGoal accepted → keep the card as started (command_result.goal). Do not
			// clear: watchGoal can miss GoalUpdated(started) when it tails from currentMaxSeq.
			if (
				event.name === 'CancelGoal' &&
				event.status !== 'error' &&
				state.goalCard?.phase === 'awaiting_confirm'
			) {
				clearedPending = {...withTranscript, goalCard: undefined};
			} else if (
				event.name === 'ConfirmGoal' &&
				(event.status === 'accepted' || event.status === 'success')
			) {
				const g = event.goal;
				const started =
					g?.status === 'running' ||
					(event.message?.includes('confirmed+started') ?? false);
				if (started) {
					const prev = state.goalCard;
					const goalId = g?.id ?? prev?.goalId;
					if (goalId) {
						clearedPending = {
							...withTranscript,
							goalCard: {
								goalId,
								phase: 'started',
								status: g?.status ?? 'running',
								name: g?.name ?? prev?.name,
								statement: g?.statement ?? prev?.statement,
								acceptance: g?.acceptance ?? prev?.acceptance,
								workflowJson: g?.workflowJson ?? prev?.workflowJson,
								budgetJson: g?.budgetJson ?? prev?.budgetJson,
								membersJson: g?.membersJson ?? prev?.membersJson,
								loopAgentId: g?.loopAgentId ?? prev?.loopAgentId,
								resultSummary: g?.resultSummary ?? prev?.resultSummary,
								currentStepIds: mergeIdList(
									prev?.currentStepIds,
									g?.currentStepIds,
									g?.currentStepId
								),
								activeRunIds: mergeIdList(
									prev?.activeRunIds,
									g?.activeRunIds,
									g?.activeRunId
								),
								progressJson: g?.progressJson ?? prev?.progressJson
							},
							// Goal track is not a Chat-turn straggler — lift postRunTerminal.
							transcript: {...withTranscript.transcript, postRunTerminal: false}
						};
					}
				}
			}
			// ②′ card refresh: a successful PatchGoal result carries the canonical snapshot
			// (deterministic reply — no dependency on a live event stream being open).
			if (
				event.name === 'PatchGoal' &&
				event.status === 'accepted' &&
				event.goal &&
				state.goalCard?.phase === 'awaiting_confirm' &&
				state.goalCard.goalId === event.goal.id
			) {
				const g = event.goal;
				clearedPending = {
					...clearedPending,
					goalCard: {
						...state.goalCard,
						status: g.status,
						name: g.name ?? state.goalCard.name,
						statement: g.statement ?? state.goalCard.statement,
						acceptance: g.acceptance ?? state.goalCard.acceptance,
						workflowJson: g.workflowJson ?? state.goalCard.workflowJson,
						budgetJson: g.budgetJson ?? state.goalCard.budgetJson,
						membersJson: g.membersJson ?? state.goalCard.membersJson,
						loopAgentId: g.loopAgentId ?? state.goalCard.loopAgentId,
						currentStepIds: mergeIdList(
							state.goalCard.currentStepIds,
							g.currentStepIds,
							g.currentStepId
						),
						activeRunIds: mergeIdList(
							state.goalCard.activeRunIds,
							g.activeRunIds,
							g.activeRunId
						),
						progressJson: g.progressJson ?? state.goalCard.progressJson
					}
				};
			}
			// Host protocol ACKs (EnsureProject, …): log-only, no transcript card.
			if (isSilentCommandResult(event.name)) {
				return appendDebugEvent(
					{
						...clearedPending,
						status: event.status === 'unavailable' ? `unavailable:${event.name}` : event.name
					},
					`command_result ${event.name} ${event.status ?? 'success'}`
				);
			}
			const modeMatch = event.status === 'error' ? null : event.message.match(/^Mode -> (\w+)/);
			const agentMode = modeMatch?.[1] ?? state.agentMode;
			if (isRepeatedCommandResult(clearedPending.localTurns, event.name, event.message, event.status ?? 'success')) {
				return {...clearedPending, agentMode, status: event.status === 'unavailable' ? `unavailable:${event.name}` : event.name};
			}
			const card: Message = {
				id: nextId('command'),
				role: 'system',
				text: event.message,
				kind: 'command_result',
				commandName: event.name,
				commandStatus: event.status ?? 'success',
				capability: event.capability,
				availability: event.availability
			};
			const cardStatus = event.status === 'error' ? 'failed' as const : 'success' as const;
			const status = event.status === 'unavailable' ? `unavailable:${event.name}` : event.name;
			// Attach to the matching pending slash turn; otherwise open a new streamSeq slot
			// so the card lands in chronological order (not glued under an older local turn).
			if (canAttachCommandResult(clearedPending.localTurns, event.name)) {
				return {
					...clearedPending,
					agentMode,
					status,
					localTurns: clearedPending.localTurns.map((turn, index) =>
						index === clearedPending.localTurns.length - 1
							? {
								...turn,
								status: cardStatus,
								systemMessages: [...turn.systemMessages, card],
								segments: [...turn.segments, {kind: 'system' as const, id: nextId('seg'), messageId: card.id}]
							}
							: turn
					)
				};
			}
			const seq = clearedPending.nextStreamSeq;
			return {
				...clearedPending,
				nextStreamSeq: seq + 1,
				agentMode,
				localTurns: [
					...clearedPending.localTurns,
					...appendSystemMessage([], card, cardStatus, seq)
				],
				status
			};
		}
		case 'model_changed':
			return {...withTranscript, model: event.model, modelDisplay: event.modelDisplay ?? event.model, status: `model ${event.modelDisplay ?? event.model}`};
		case 'commands_available':
			return {...withTranscript, commands: event.commands};
		case 'context_compressed':
			return {...withTranscript, status: `context compressed ${Math.round(event.ratio * 100)}%`};
		case 'budget_exhausted':
			return {...withTranscript, status: `budget exhausted ${event.turns} turns / ${event.tokens} tokens`};
		case 'clarify':
			return {
				...pushLocalSystem(withTranscript, {
					id: `question_${Date.now()}`,
					role: 'system',
					text: event.question
				}),
				inputMode: 'clarify',
				status: 'question'
			};
		case 'clarify_resolved':
			return {
				...withTranscript,
				inputMode: state.running ? 'running' : 'normal'
			};
		case 'question_requested':
			return {
				...pushLocalSystem(withTranscript, {
					id: `question_${Date.now()}`,
					role: 'system',
					text: event.question
				}),
				inputMode: 'question',
				status: 'question'
			};
		case 'question_answered':
			return {
				...withTranscript,
				inputMode: state.running ? 'running' : 'normal',
				status: 'answered'
			};
		case 'agent_final_answer':
			return {
				...withTranscript,
				...stampEntryStreamSeq(
					withTranscript,
					applyBridgeEvent(withTranscript.transcript, {
						type: 'final_answer',
						turnId: event.turnId,
						text: event.text
					})
				)
			};
		case 'run_done': {
			return {
				...withTranscript,
				running: false,
				inputMode: promptInputMode(withTranscript, state.queue.length > 0 ? 'queued' : 'normal'),
				agentRuns: [],
				approvalDecisions: {},
				lastFailure: event.success ? null : state.lastFailure,
				status: event.success ? 'run done' : 'run failed'
			};
		}
		case 'run_failed': {
			return {
				...pushLocalSystem(withTranscript, {
					id: `run_failed_${Date.now()}`,
					role: 'system',
					text: faultHeadline(event.fault),
					detail: event.error
				}),
				running: false,
				inputMode: promptInputMode(withTranscript, state.queue.length > 0 ? 'queued' : 'normal'),
				agentRuns: [],
				approvalDecisions: {},
				errors: [...state.errors, event.error],
				lastFailure: {runId: event.runId, acceptedTurns: event.fault?.acceptedTurns ?? null},
				status: 'run failed'
			};
		}
		case 'run_exhausted': {
			return {
				...pushLocalSystem(withTranscript, {
					id: `run_exhausted_${Date.now()}`,
					role: 'system',
					text: `已达最大轮次: ${event.reason}`
				}),
				running: false,
				inputMode: promptInputMode(withTranscript, state.queue.length > 0 ? 'queued' : 'normal'),
				agentRuns: [],
				approvalDecisions: {},
				errors: [...state.errors, event.reason],
				status: 'run exhausted'
			};
		}
		case 'run_cancelled': {
			if (withTranscript.transcript.awaitingCancelSettlement) {
				return {
					...withTranscript,
					agentRuns: [],
					approvalDecisions: {},
					status: `run cancelled: ${event.reason}`
				};
			}
			return {
				...withTranscript,
				running: false,
				inputMode: promptInputMode(withTranscript, state.queue.length > 0 ? 'queued' : 'normal'),
				agentRuns: [],
				approvalDecisions: {},
				status: `run cancelled: ${event.reason}`
			};
		}
		case 'agent_call_started': {
			// L1 Goal steps: status is goal_updated / child_work — do not open a TUI agent row.
			if ('goalId' in event && typeof event.goalId === 'string' && event.goalId.trim()) {
				return withTranscript;
			}
			const runId = event.runId ?? event.agentId;
			if (state.agentRuns.some(ar => ar.runId === runId)) return withTranscript;
			if (withTranscript.transcript.postRunTerminal) return withTranscript;
			const parent = state.agentRuns.find(ar => ar.runId === event.parentRunId);
			const runningRoot = parent ? undefined : state.agentRuns.find(ar =>
				ar.status === 'running' && !state.agentRuns.some(other => other.runId === ar.parentRunId));
			const batchOf = (ar: AgentRun) => ar.batchId ?? ar.runId;
			const isRetry = state.agentRuns.some(ar =>
				ar.status === 'failed' && ar.name === event.name && ar.parentRunId === event.parentRunId);
			return {
				...withTranscript,
				agentRuns: [
					...state.agentRuns,
					{
						runId,
						agentId: event.agentId,
						parentAgentId: event.parentAgentId,
						parentRunId: event.parentRunId,
						batchId: parent ? batchOf(parent) : runningRoot ? batchOf(runningRoot) : undefined,
						depth: event.depth ?? 0,
						name: event.name,
						status: 'running',
						startedAt: Date.now(),
						toolCalls: 0,
						...(isRetry ? {isRetry: true} : {})
					}
				]
			};
		}
		case 'agent_call_finished': {
			const matches = (ar: AgentRun) =>
				event.runId ? ar.runId === event.runId : ar.agentId === event.agentId && ar.status === 'running';
			return {
				...withTranscript,
				agentRuns: state.agentRuns.map(ar =>
					matches(ar)
						? {
							...ar,
							status: event.success ? 'success' : 'failed',
							elapsedMs: event.elapsedMs,
							tokensUsed: event.tokensUsed,
							toolCalls: event.toolCalls ?? ar.toolCalls,
							currentTool: undefined,
							detail: event.detail,
							resultSummary: event.resultSummary
						}
						: ar
				)
			};
		}
		case 'task_done':
			return {...withTranscript, status: event.success ? 'task done' : 'task failed'};
		case 'task_failed':
			return {...withTranscript, errors: [...state.errors, event.error], status: 'task failed'};
		case 'task_cancelled':
			return {...withTranscript, status: `task cancelled: ${event.reason}`};
		case 'agent_timeline':
			return {
				...withTranscript,
				agentTimelines: {
					...state.agentTimelines,
					[event.agentId]: {
						agentId: event.agentId,
						parentAgentId: event.parentAgentId,
						name: event.name,
						turns: event.turns.map(t => ({turnId: t.turnId, userText: t.userText, assistantText: t.assistantText})),
						children: event.children ?? []
					}
				},
				status: `agent_timeline ${event.name}`
			};
		case 'open_project_set':
			// Legacy Engine open-set — ignored; Meta uses workspace_meta.
			return withTranscript;
		case 'workspace_meta':
			return withTranscript;
		case 'session_history_page':
			return withTranscript;
		case 'goal_updated': {
			// ②′ card lifecycle: the single source for confirm card / busy banner /
			// escalate card / completion card — no chat-text or tool-output parsing.
			const card: GoalCardState = {
				goalId: event.goalId,
				phase: event.phase,
				status: event.status,
				name: event.name ?? undefined,
				statement: event.statement ?? undefined,
				acceptance: event.acceptance ?? undefined,
				workflowJson: event.workflowJson ?? undefined,
				membersJson: event.membersJson ?? undefined,
				budgetJson: event.budgetJson ?? undefined,
				loopAgentId: event.loopAgentId ?? undefined,
				resultSummary: event.resultSummary ?? undefined,
				escalateActions: event.escalateActions,
				reason: event.reason ?? undefined,
				currentStepIds: pickIdList(event.currentStepIds, event.currentStepId),
				activeRunIds: pickIdList(event.activeRunIds, event.activeRunId),
				progressJson: event.progressJson ?? undefined,
				escalateKind:
					event.escalateKind === 'infra' || event.escalateKind === 'decision'
						? event.escalateKind
						: undefined
			};
			// A started push for another goal must not clobber a live confirm card for a newer one.
			if (
				state.goalCard &&
				state.goalCard.goalId !== event.goalId &&
				state.goalCard.phase === 'awaiting_confirm' &&
				event.phase !== 'awaiting_confirm'
			) {
				return {...withTranscript, status: `goal ${event.phase}`};
			}
			const liftGuard =
				event.phase === 'started' || event.phase === 'paused' || event.phase === 'escalated';
			return {
				...withTranscript,
				goalCard: card,
				status: `goal ${event.phase}`,
				transcript: liftGuard
					? {...withTranscript.transcript, postRunTerminal: false}
					: withTranscript.transcript
			};
		}
		case 'error':
			return {...withTranscript, errors: [...state.errors, event.message], status: 'error'};
		default:
			return withTranscript;
	}
}

function seedOptimisticTurn(transcript: TranscriptState, text: string, clientMessageId: string): TranscriptState {
	return {
		...transcript,
		postRunTerminal: false,
		awaitingCancelSettlement: false,
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

function markClientRejected(transcript: TranscriptState, clientMessageId: string): TranscriptState {
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

function promptInputMode(state: UiState, fallback: UiState['inputMode']): UiState['inputMode'] {
	if (state.transcript.approvals.length > 0) return 'approval';
	if (state.transcript.questions.length > 0) return 'question';
	return fallback;
}

function omitDecision(
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
function trackDefinedAgents(state: UiState, tool: string, toolId: string, success: boolean): UiState {
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

function appendDebugEvent(state: UiState, eventType: string): UiState {
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
function detailField(message: string, key: string): string | undefined {
	const match = message.match(new RegExp(`(?:^|[;\\s])${key}=([^;\\s]+)`));
	return match?.[1];
}

function isRepeatedCommandResult(turns: Turn[], name: string, text: string, status: string): boolean {
	const last = turns.at(-1);
	const lastMessage = last?.systemMessages.at(-1);
	if (!last || !lastMessage || lastMessage.kind !== 'command_result') return false;
	const lastSegment = last.segments.at(-1);
	if (lastSegment?.kind !== 'system' || lastSegment.messageId !== lastMessage.id) return false;
	return lastMessage.commandName === name && lastMessage.text === text && lastMessage.commandStatus === status;
}

/** True when the latest local turn is the matching `/name` slash waiting for its result. */
function canAttachCommandResult(turns: Turn[], name: string | undefined): boolean {
	if (!name) return false;
	const last = turns.at(-1);
	if (!last) return false;
	if (last.systemMessages.some(m => m.kind === 'command_result')) return false;
	const slash = `/${name}`.toLowerCase();
	const user = last.userText.trim().toLowerCase();
	return user === slash || user.startsWith(`${slash} `);
}

/** Fold prior interactive command menus (/skills list) when the user continues. */
function collapseCommandMenus(turns: Turn[]): Turn[] {
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
function stampEntryStreamSeq(
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
function pushLocalSystem(state: UiState, message: Message, status?: Turn['status']): UiState {
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

function appendSystemMessage(
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
