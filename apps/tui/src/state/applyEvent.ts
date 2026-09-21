import {
	applyBridgeEvent,
	chromeAwaitingSettlement,
	chromePostRun,
	contextPruneText,
	runChromeTransition
} from '@fast-ide/session-view';
import type {BridgeEvent} from '../rpc/protocol.js';
import {isSilentCommandResult} from '../rpc/hostProtocolCommands.js';
import {isSessionStreamEvent, pickIdList} from '@fastllm/bridge-protocol';
import type {AgentRun, GoalCardState, Message, UiState} from './model.js';
import {
	appendDebugEvent,
	appendSystemMessage,
	canAttachCommandResult,
	collapseCommandMenus,
	detailField,
	faultHeadline,
	isRepeatedCommandResult,
	markClientRejected,
	matchesAgentEvent,
	mergeIdList,
	nextId,
	omitDecision,
	promptInputMode,
	pushLocalSystem,
	rerunRejectionText,
	stampEntryStreamSeq,
	toolActivity,
	trackDefinedAgents
} from './reducer.js';

export function applyEvent(state: UiState, event: BridgeEvent): UiState {
	const withTranscript = isSessionStreamEvent(event.type)
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
				isSessionStreamEvent(event.type)
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
							// Goal track is not a Chat-turn straggler — lift the postRun guard.
							transcript: {...withTranscript.transcript, chrome: runChromeTransition(withTranscript.transcript.chrome, {postRun: false})}
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
			if (chromeAwaitingSettlement(withTranscript.transcript.chrome)) {
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
			if (chromePostRun(withTranscript.transcript.chrome)) return withTranscript;
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
					? {...withTranscript.transcript, chrome: runChromeTransition(withTranscript.transcript.chrome, {postRun: false})}
					: withTranscript.transcript
			};
		}
		case 'error':
			return {...withTranscript, errors: [...state.errors, event.message], status: 'error'};
		case 'context_pruned': {
			// Compaction result as a visible system line (the running phase rides the streaming
			// answer's wait chrome via session-view). Pure window trims stay quiet, and so does a
			// replayed event session-view already deduplicated (notice list unchanged by reference).
			const notices = withTranscript.transcript.contextPrunes;
			const appended = notices !== state.transcript.contextPrunes ? notices?.at(-1) : undefined;
			return appended && COMPACTION_REASONS.has(appended.reason)
				? pushLocalSystem(withTranscript, {id: nextId('system'), role: 'system', text: contextPruneText(appended)})
				: withTranscript;
		}
		default:
			return withTranscript;
	}
}

const COMPACTION_REASONS = new Set(['summary', 'summary-fallback', 'summary-breaker', 'compaction', 'nothing-to-compact']);
