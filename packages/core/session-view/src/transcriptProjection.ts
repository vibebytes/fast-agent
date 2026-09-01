import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {
	mergePlanPatch,
	planBuildDisplayContent,
	planFromWire,
	type PlanView
} from './plan.js';
import {normalizeToolOutput, parseExitCode, resolveToolStatus} from './toolOutput.js';
import {documentCard, forgetDocument, rememberDocument} from './chatDocument.js';

export type ToolCallView = {
	id: string;
	tool: string;
	args?: Record<string, string>;
	output?: string;
	/** Bridge tool_finished fields (may include exit / exit_code). */
	fields?: Record<string, string>;
	exitCode?: string;
	status: 'running' | 'success' | 'error' | 'cancelled';
	/** Epoch ms when the tool entered running (client clock). */
	startedAt?: number;
	/** Subagent delegation run id (agent_call_*); keys finish patches per delegation. */
	agentRunId?: string;
	/** Live wait/retry note from the workload wire (e.g. "waiting llm 5s"); running rows only. */
	statusNote?: string;
	/** Unknown DSH tool — session-view prefers this over generic by event type. */
	dshCard?: {name: string; title: string; args: Record<string, string>; result?: string};
};

/** Interleaved assistant text / tool groups / thinking (cli-ink TurnSegment subset). */
export type EntrySegment =
	| {kind: 'assistant'; id: string; text: string; unitId?: string}
	| {kind: 'tools'; id: string; toolIds: string[]}
	| {
			kind: 'thinking';
			id: string;
			text: string;
			/** Client epoch ms when this Thought opened. */
			startedAt?: number;
			/** Client epoch ms when sealed by a following non-thinking segment or turn end. */
			sealedAt?: number;
	  }
	/** Session Plan card (`message_type=plan`); do not derive from thin upsert_plan tool_result. */
	| {kind: 'plan'; id: string; plan: PlanView};

/** Live network-wait UI on a streaming assistant (ADR-0005). Not restored from history. */
export type NetworkWaitState = {
	phase: 'retrying' | 'waiting';
	attempt?: number;
	maxAttempts?: number;
	reason?: string;
	elapsedMs?: number;
};

export type TranscriptEntry = {
	id: string;
	role: 'user' | 'assistant';
	text: string;
	reasoning?: string;
	status: 'streaming' | 'done' | 'error' | 'cancelled';
	turnId?: string;
	/** Client message id — Engine may later remap turnId to a server run id. */
	clientMessageId?: string;
	/** e.g. scheduler_generated when fired by a scheduled job. */
	origin?: string;
	/** User message_type when plan_build; assistant when goal_step_conclusion / goal_outcome. */
	messageType?: string;
	/** PlanBuild → plan message id. */
	planId?: string;
	/** PlanBuild display name. */
	planName?: string;
	/** Goal step conclusion: member display name (wire agentName). */
	goalAgentName?: string;
	/** Goal step conclusion: `pass` | `reject`. */
	goalVerdict?: 'pass' | 'reject';
	/** Goal step / outcome goal id. */
	goalId?: string;
	/** Goal step id when known. */
	goalStepId?: string;
	/** Goal outcome: `passed` | `failed` | `cancelled`. */
	goalStatus?: string;
	tools?: ToolCallView[];
	/** Ordered segments so preamble text appears before tools. */
	segments?: EntrySegment[];
	/** Replaces Thinking label while set; cleared on first packet / turn end. */
	waitState?: NetworkWaitState;
	/** Fast seq hole could not be filled; live text must not be completed-state patched. */
	streamIncomplete?: boolean;
	/** Orphan seal: turn ended without a confirmed terminal — not success, not cancelled. */
	sealedUnconfirmed?: boolean;
	/** Structured failure info (P1a) from run_failed; drives the ErrorCardRow affordances. */
	fault?: {
		kind: string;
		remedy: string;
		retryableAfterMs?: number;
		attempts?: number;
		acceptedTurns?: number;
	};
};

export type PendingApproval = {
	id: string;
	runId: string;
	tool: string;
	description: string;
	risk?: string;
	context?: string;
	/** Engine-supplied footer; empty/absent keeps the canned reason. */
	note?: string;
};

export type PendingQuestion = {
	id: string;
	runId: string;
	title?: string;
	question: string;
	options: Array<{id: string; label: string; description?: string}>;
	allowCustom?: boolean;
};

export type QuestionBatchOption = {label: string; description?: string};
export type QuestionBatchIntent = {kind: string; approve: string};
export type QuestionBatchItem = {
	id: string;
	question: string;
	detail?: string;
	header?: string;
	options?: QuestionBatchOption[];
	multiSelect?: boolean;
	intent?: QuestionBatchIntent;
};
export type PendingQuestionBatch = {
	rpcId: string;
	runId: string;
	questions: QuestionBatchItem[];
};

/** DSH child Work card on the parent timeline. Upserted by childSessionId. */
export type TranscriptSubagent = {
	childSessionId: string;
	mode: 'one-shot' | 'continuable';
	label: string;
	activity: 'running' | 'inactive';
	status?: 'completed' | 'failed' | 'cancelled';
	summary?: string;
	preview?: string;
	runId?: string;
};

/** Cap for P1 UI preview kept on each LiveProc (tail only). */
export const LIVE_PROC_PREVIEW_MAX = 4 * 1024;

/** Session-scoped loop / automation row for Composer background drawer. */
export type LiveTask = {
	taskId: string;
	kind: 'loop' | 'automation';
	status: string;
	title?: string;
	detail?: string;
	/** ISO next_fire_at from task_updated detail (`next=...`). */
	nextFireAt?: string;
	/** Client clock when first seen active. */
	startedAt: number;
};

/** Parse `next=<iso>` from TaskUpdated.detail. */
export function nextFireAtFromDetail(detail: string | undefined | null): string | undefined {
	if (!detail) return undefined;
	const m = detail.match(/(?:^|\s)next=(\S+)/);
	return m?.[1];
}

const LIVE_TASK_TERMINAL = new Set(['cancelled', 'expired']);

/**
 * Unified child-workload drawer row — mirrors Bridge `child_work_changed`
 * (lifecycle + optional rolling outputPreview from WorkloadHub).
 * Goal rows stay on the Goal card and procs on LiveProc — this list carries
 * the kinds those surfaces miss (goal step runs / subagents / fires).
 */
export type LiveChildWork = {
	kind: string;
	id: string;
	parentRef?: string;
	title: string;
	status: string;
	summary?: string;
	/** Rolling tool/proc output tail from the wire (replace semantics). */
	outputPreview?: string;
	/** L1 Goal step identity from Bridge (RunCreated → child_work_changed). */
	goalId?: string;
	stepId?: string;
	/** Client clock when first seen active. */
	startedAt: number;
};

/** Chat-flow Goal member status (from agent_call_* with goalId — not a body card). */
export type GoalFlowMember = {
	runId: string;
	name: string;
	stepId?: string;
	status: 'running' | 'success' | 'error' | 'cancelled';
};

export type GoalFlowView = {
	goalId: string;
	members: GoalFlowMember[];
};

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

/** Session-scoped live Proc (Fg/Bg) for Composer Proc drawer — survives turn completion. */
export type LiveProc = {
	procId: string;
	command: string;
	runId?: string;
	outFile?: string;
	status: 'running' | 'exited' | 'killed';
	reason?: string;
	/** Client clock when first seen running. */
	startedAt: number;
	/** P1: rolling tail of background_task_output (UI only, not LLM). */
	outputPreview?: string;
};

/** Append a delta into a rolling preview tail. */
export function appendProcPreview(prev: string | undefined, chunk: string, max = LIVE_PROC_PREVIEW_MAX): string {
	const next = `${prev ?? ''}${chunk}`;
	return next.length > max ? next.slice(-max) : next;
}

export type TranscriptState = {
	entries: TranscriptEntry[];
	approvals: PendingApproval[];
	questions: PendingQuestion[];
	questionBatches: PendingQuestionBatch[];
	/** DSH child Work cards. Optional on old IPC/cache snapshots. */
	subagents: TranscriptSubagent[];
	/** Latest server Run id for CancelRun when present. */
	activeRunId?: string;
	/**
	 * True only when `activeRunId` was confirmed by the Engine (input_accepted remap /
	 * run-scoped Engine events). A peer-turn pin (turn_started turnId, Composer Gate
	 * bookkeeping) is NOT server-confirmed — CancelRun with such an id would target a
	 * non-existent Run; callers must fall back to CancelSession.
	 */
	activeRunFromServer?: boolean;
	/**
	 * After local cancel, turn settle, or a settled `session_restored` (no live
	 * streaming), ignore content deltas / persist TurnStarted / persist prompt
	 * openers that would re-arm Stop until the next user turn (cli-ink postRunTerminal).
	 */
	postRunTerminal?: boolean;
	/**
	 * User prompts painted by the last settled `session_restored` snapshot.
	 * Replayed openers repeating one of these are attach replay, not a new turn.
	 */
	restoredPromptTexts?: string[];
	/**
	 * Document slot for the current user chat run (cmid, then server run id).
	 * Survives settle / approval; cleared on cancel of this run or the next submit.
	 */
	lastDocumentId?: string;
	/** Stopping: awaiting Bridge `turn_cancelled` after local cancel. */
	awaitingCancelSettlement?: boolean;
	/** ADR-0012: older Turns remain beyond the loaded window. */
	hasMoreOlder?: boolean;
	/** ADR-0012: total MESSAGE-derived Turn count for the Session. */
	totalTurnCount?: number;
	/** Session-level Proc drawer rows (not merely in-flight transcript tool rows). */
	liveProcs?: LiveProc[];
	/** Session-level loop / automation drawer rows from task_updated. */
	liveTasks?: LiveTask[];
	/** Unified child-workload rows from child_work_changed (goal steps / subagents / fires). */
	childWork?: LiveChildWork[];
	/**
	 * Chat message-flow Goal status (L1 members). Updated by agent_call_* with goalId;
	 * does not create Subagent body cards.
	 */
	goalFlow?: GoalFlowView;
	/**
	 * P1b rerun provenance: victim runId → superseding turn id (from restored
	 * payloadJson.supersedes). Drives D10 direct-replace hiding in the timeline.
	 */
	superseded?: Record<string, string>;
};

export function createTranscriptState(): TranscriptState {
	return {
		entries: [],
		approvals: [],
		questions: [],
		questionBatches: [],
		subagents: [],
		hasMoreOlder: false,
		liveProcs: [],
		liveTasks: [],
		childWork: []
	};
}

/** Oldest loaded Turn id (for FetchSessionHistory `beforeTurnId`). */
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

export function oldestLoadedTurnId(state: TranscriptState): string | undefined {
	for (const entry of state.entries) {
		if (entry.turnId) return entry.turnId;
	}
	return undefined;
}

const CONTENT_EVENTS = new Set([
	'reasoning_delta',
	'assistant_delta',
	'checkpoint',
	'final_answer',
	'tool_started',
	'tool_output',
	'tool_finished',
	'file_read',
	'agent_call_started',
	'agent_call_finished'
]);

export function applyLocalCancel(state: TranscriptState): TranscriptState {
	return {
		...forgetDocument(state),
		approvals: state.approvals.filter(a => !a.runId),
		questions: [],
		questionBatches: state.questionBatches.filter(q => !q.runId),
		postRunTerminal: true,
		awaitingCancelSettlement: true,
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

function eventGoalId(event: BridgeEvent): string | undefined {
	if (!('goalId' in event) || typeof event.goalId !== 'string') return undefined;
	const id = event.goalId.trim();
	return id || undefined;
}

export function applyBridgeEvent(state: TranscriptState, event: BridgeEvent): TranscriptState {
	if (state.postRunTerminal && CONTENT_EVENTS.has(event.type)) {
		// L1 Goal agent_call still updates chat status after the Chat turn sealed.
		const gid = eventGoalId(event);
		const goalCall =
			(event.type === 'agent_call_started' || event.type === 'agent_call_finished') && gid;
		// Goal structured turns (step conclusion / outcome) finish via final_answer after seal.
		const goalSystemTurn =
			(event.type === 'final_answer' || event.type === 'turn_finished') &&
			typeof event.turnId === 'string' &&
			state.entries.some(
				e =>
					e.role === 'assistant' &&
					e.status === 'streaming' &&
					(e.turnId === event.turnId || e.clientMessageId === event.turnId) &&
					(e.messageType === 'goal_step_conclusion' || e.messageType === 'goal_outcome')
			);
		// Settle can race ahead of the document (held deltas / late final_answer).
		// Fill empty prose without reopening the stream — restart restore already does this.
		if (!goalCall && !goalSystemTurn && !fillsEmptyAssistant(state, event)) {
			return state;
		}
	}

	switch (event.type) {
		case 'turn_started': {
			// Structured Goal system turns — not chat runs (do not arm activeRunId / Stop).
			const goalMsg =
				event.messageType === 'goal_step_conclusion' || event.messageType === 'goal_outcome'
					? event.messageType
					: null;
			// Settled restore: persist chat openers must not relight Stop. Goal notices
			// after a plan Chat seal still paint (they are not chat replay). A live NEW
			// turn (unknown id, unseen prompt) must still paint — first turn on a
			// freshly restored empty session and cancel→resubmit depend on it.
			if (state.postRunTerminal && isAttachReplayChatOpener(event)) {
				if (isKnownTurnOpener(state, event)) return state;
			}
			if (goalMsg) {
				const turnKey = event.turnId ?? event.clientMessageId ?? `goal-${state.entries.length}`;
				const verdictRaw =
					typeof event.verdict === 'string' ? event.verdict.trim().toLowerCase() : '';
				const verdict =
					verdictRaw === 'pass' || verdictRaw === 'reject' ? verdictRaw : undefined;
				const agentName =
					typeof event.agentName === 'string' && event.agentName.trim()
						? event.agentName.trim()
						: undefined;
				const goalId =
					typeof event.goalId === 'string' && event.goalId.trim()
						? event.goalId.trim()
						: undefined;
				const stepId =
					typeof event.stepId === 'string' && event.stepId.trim()
						? event.stepId.trim()
						: undefined;
				const goalStatus =
					typeof event.goalStatus === 'string' && event.goalStatus.trim()
						? event.goalStatus.trim()
						: undefined;
				const staleStreamingSealed = state.entries.map(entry =>
					entry.role === 'assistant' && entry.status === 'streaming'
						? sealStreamingAsDone(entry)
						: entry
				);
				return {
					...state,
					entries: [
						...staleStreamingSealed,
						{
							id: `assistant-${turnKey}`,
							role: 'assistant',
							text: '',
							reasoning: '',
							status: 'streaming',
							turnId: event.turnId ?? turnKey,
							clientMessageId: event.clientMessageId ?? turnKey,
							messageType: goalMsg,
							...(agentName ? {goalAgentName: agentName} : {}),
							...(verdict ? {goalVerdict: verdict} : {}),
							...(goalId ? {goalId} : {}),
							...(stepId ? {goalStepId: stepId} : {}),
							...(goalStatus ? {goalStatus} : {})
						}
					],
					// Keep chat Stop / postRunTerminal as they were — Goal notices are not a run.
					postRunTerminal: state.postRunTerminal,
					awaitingCancelSettlement: false
				};
			}
			// Idempotent: double input_accepted remaps turnId; a later turn_started
			// with the server Run id must not spawn a duplicate pair (cli-ink ensureTurn).
			const existingAssistant =
				state.entries.find(
					e =>
						e.role === 'assistant' &&
						e.status === 'streaming' &&
						((event.clientMessageId &&
							(e.clientMessageId === event.clientMessageId || e.turnId === event.clientMessageId)) ||
							(event.turnId && (e.turnId === event.turnId || e.clientMessageId === event.turnId)))
				) ??
				riverEchoAssistant(state, event) ??
				resumeSealedAssistant(state, event) ??
				(isRiverTurnStarted(event)
					? documentCard(state, event.turnId ?? event.clientMessageId)
					: undefined);
			const planBuildFields =
				event.messageType === 'plan_build' && event.planId
					? {
							messageType: 'plan_build' as const,
							planId: event.planId,
							planName: event.planName?.trim() || undefined
						}
					: null;
			if (existingAssistant) {
				// Persist TurnStarted (empty text) after settle must not clear postRunTerminal
				// or the Composer Stop relights on attach replay.
				if (state.postRunTerminal && isRiverTurnStarted(event)) return state;
				return {
					...rememberDocument(
						state,
						existingAssistant.turnId ?? event.turnId ?? event.clientMessageId
					),
					postRunTerminal: false,
					awaitingCancelSettlement: false,
					entries: state.entries.map(entry => {
						const matchesAssistant = entry === existingAssistant;
						const matchesUser =
							entry.role === 'user' &&
							(entry.clientMessageId === existingAssistant.clientMessageId ||
								entry.turnId === existingAssistant.turnId ||
								entry.turnId === existingAssistant.clientMessageId);
						if (!matchesAssistant && !matchesUser) return entry;
						const schedOrigin =
							event.clientMessageId?.startsWith('sched-') ? 'scheduler_generated' : entry.origin;
						const persistRiver =
							typeof event.eventSeq === 'number' &&
							event.eventSeq > 0 &&
							event.messageType !== 'plan_build';
						const text =
							matchesUser &&
							!persistRiver &&
							!(entry.text ?? '').trim() &&
							(event.text ?? '').trim()
								? event.text!
								: entry.text;
						return {
							...entry,
							...(matchesUser && text !== entry.text ? {text} : {}),
							// Approval seals the row (`done`) so Stop goes out. The next
							// ReAct TurnStarted is the same chat turn — reopen, do not split.
							...(matchesAssistant && entry.status === 'done' ? {status: 'streaming' as const} : {}),
							// Keep input_accepted run id. River TurnStarted carries
							// `$runId-turn-N` and must not overwrite it — run_done keys on run id.
							turnId: entry.turnId ?? event.turnId,
							clientMessageId: event.clientMessageId ?? entry.clientMessageId,
							...(schedOrigin ? {origin: schedOrigin} : {}),
							...(matchesUser && planBuildFields ? planBuildFields : {})
						};
					})
				};
			}
			// River/persist TurnStarted is an opener, not a user turn. After the chat
			// message has settled, attaching or replaying that seq must not spawn a
			// new streaming row (Composer Stop stays lit with a finished bubble).
			if (state.postRunTerminal && isRiverTurnStarted(event)) return state;
			// Seal any orphaned streaming assistant from a prior turn that never received
			// turn_finished/turn_cancelled (e.g. silent LLM stream drop). Without this the
			// patchAssistant fallback would route the new turn's deltas into the stale entry,
			// making replies render under the first message instead of the current one.
			// Neutral seal is `done`, not `cancelled`: the user did not Stop, the engine did
			// not abort. `cancelled` is reserved for applyLocalCancel / turn_cancelled /
			// run_cancelled so the process stack only shows 已取消 for a real stop.
			const staleStreamingSealed = state.entries.map(entry =>
				entry.role === 'assistant' && entry.status === 'streaming'
					? sealStreamingAsDone(entry)
					: entry
			);
			const schedOrigin =
				event.clientMessageId?.startsWith('sched-') ? 'scheduler_generated' : undefined;
			const userText = (event.text ?? '').trim()
				? event.text!
				: planBuildFields
					? planBuildDisplayContent(event.planName ?? '', event.planId!)
					: '';
			const planBuild = planBuildFields ?? {};
			const entries = [...staleStreamingSealed];
			if (userText || planBuildFields) {
				entries.push({
					id: `user-${event.turnId ?? entries.length}`,
					role: 'user',
					text: userText,
					status: 'done',
					turnId: event.turnId,
					clientMessageId: event.clientMessageId,
					...(schedOrigin ? {origin: schedOrigin} : {}),
					...planBuild
				});
			}
			entries.push({
				id: `assistant-${event.turnId ?? entries.length}`,
				role: 'assistant',
				text: '',
				reasoning: '',
				status: 'streaming',
				turnId: event.turnId,
				clientMessageId: event.clientMessageId ?? event.turnId,
				tools: [],
				segments: []
			});
			// Peer turns (IDE → ink) never seed optimistic activeRunId; pin turnId so Composer Gate enqueues.
			return {
				...rememberDocument(state, event.turnId ?? event.clientMessageId),
				entries,
				activeRunId: event.turnId ?? state.activeRunId,
				activeRunFromServer: event.turnId ? false : state.activeRunFromServer,
				postRunTerminal: false,
				awaitingCancelSettlement: false
			};
		}
		case 'input_accepted': {
			if (!event.turnId && !event.clientMessageId) return state;
			// Attach replay of the last Accept must not relight Stop on a settled restore.
			if (state.postRunTerminal && !state.entries.some(e => e.status === 'streaming')) return state;
			// Second accept remaps client id → server Run id (cli-ink serverTurnId).
			// Entry `id` stays stable (TUI <Static> / VirtualTranscript keys).
			// Do NOT clear awaitingCancelSettlement here — a late accept after local
			// cancel would unlock Composer before turn_cancelled (Cancel Settlement).
			const serverRunId =
				event.turnId &&
				event.clientMessageId &&
				event.turnId !== event.clientMessageId
					? event.turnId
					: undefined;
			return {
				...rememberDocument(state, serverRunId ?? event.turnId ?? event.clientMessageId),
				activeRunId: serverRunId ?? state.activeRunId,
				activeRunFromServer: serverRunId ? true : state.activeRunFromServer,
				entries: state.entries.map(entry => {
					const matchesClient =
						Boolean(event.clientMessageId) &&
						(entry.clientMessageId === event.clientMessageId ||
							entry.turnId === event.clientMessageId);
					const matchesTurn = Boolean(event.turnId) && entry.turnId === event.turnId;
					if (!matchesClient && !matchesTurn) return entry;
					if (entry.role === 'assistant' && entry.status !== 'streaming') return entry;
					return {
						...entry,
						turnId: event.turnId ?? entry.turnId,
						clientMessageId: event.clientMessageId ?? entry.clientMessageId
					};
				})
			};
		}
		case 'session_restored': {
			const activeAssistants = state.entries.filter(
				e => e.role === 'assistant' && e.status === 'streaming'
			);
			const liveIds = new Set(
				activeAssistants.flatMap(a => [a.turnId, a.clientMessageId].filter(Boolean) as string[])
			);
			const activeUsers = state.entries.filter(
				e =>
					e.role === 'user' &&
					((e.turnId && liveIds.has(e.turnId)) ||
						(e.clientMessageId && liveIds.has(e.clientMessageId)) ||
						activeAssistants.some(a => {
							const idx = state.entries.indexOf(a);
							return idx > 0 && state.entries[idx - 1] === e;
						}))
			);
			const liveUserTexts = new Set(activeUsers.map(u => u.text));
			const restoredEntries = entriesFromRestoredTurns(event.turns, liveUserTexts)
				.filter(e => !(e.turnId && liveIds.has(e.turnId)) && !(e.clientMessageId && liveIds.has(e.clientMessageId)));
			const live = activeAssistants.length > 0;
			const hydratedAssistants = activeAssistants.map(entry =>
				hydrateLiveAssistant(entry, event.turns)
			);
			const history = live
				? restoredEntries
				: keepLiveProse(restoredEntries, state.entries);
			const restoredDoc = [...history].reverse().find(e => e.role === 'assistant' && !e.messageType);
			const superseded = {...state.superseded};
			for (const rt of event.turns) {
				if (rt.supersedes) {
					superseded[rt.supersedes] = rt.turnId;
				}
			}
			return {
				...rememberDocument(state, live ? state.lastDocumentId : restoredDoc?.turnId),
				entries: [...history, ...activeUsers, ...hydratedAssistants],
				superseded,
				hasMoreOlder: event.hasMoreOlder ?? false,
				totalTurnCount: event.totalTurnCount ?? event.turns.length,
				restoredPromptTexts: event.turns.map(rt => rt.userText.trim()).filter(Boolean),
				// Cold Attach has no local streaming: history is done. Arm the same
				// straggler guard as turn_finished so persist TurnStarted cannot
				// reopen a streaming row and relight Composer Stop.
				...(live
					? {postRunTerminal: state.postRunTerminal}
					: {
							postRunTerminal: true,
							activeRunId: undefined,
							activeRunFromServer: false,
							awaitingCancelSettlement: false
						})
			};
		}
		case 'session_history_page': {
			const existingIds = new Set(state.entries.map(e => e.id));
			const older = entriesFromRestoredTurns(event.turns).filter(e => !existingIds.has(e.id));
			const superseded = {...state.superseded};
			for (const rt of event.turns) {
				if (rt.supersedes) {
					superseded[rt.supersedes] = rt.turnId;
				}
			}
			return {
				...state,
				entries: [...older, ...state.entries],
				superseded,
				hasMoreOlder: event.hasMoreOlder,
				totalTurnCount: event.totalTurnCount
			};
		}
		case 'llm_network_wait': {
			// Live-only: ignore when no streaming assistant (history / finished turns).
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
		case 'reasoning_delta': {
			// Subagent (child-run) deltas must never pollute the parent transcript. Their
			// content reaches the Subagent card via the unified workload wire
			// (child_work_changed.outputPreview) — see workload-capability.md.
			if (subagentRunIdOf(event)) return state;
			return patchAssistant(state, event.turnId, entry =>
				clearWaitState(pushThinkingSegment(entry, event.text))
			);
		}
		case 'assistant_delta': {
			if (subagentRunIdOf(event)) return state;
			return patchAssistant(state, event.turnId, entry =>
				clearWaitState(pushAssistantSegment(entry, event.text, event.unitId))
			);
		}
		case 'checkpoint': {
			return patchAssistant(state, event.turnId, entry => applyCheckpoint(entry, event.unitId, event.content));
		}
		case 'gap': {
			return markStreamIncomplete(state);
		}
		case 'final_answer': {
			// Prefer streamed deltas; only seed from final_answer when empty (cli-ink).
			return patchAssistant(state, event.turnId, entry =>
				entry.text.trim().length > 0 ? entry : pushAssistantSegment(entry, event.text)
			);
		}
		case 'turn_finished': {
			// Do not overwrite a cancelled entry (run_cancelled / local_cancel may
			// precede a late turn_finished(success:false) from Bridge).
			// Clear pending prompts: a finished turn cannot still wait on approval.
			// Arm postRunTerminal only when no other assistant is still streaming —
			// a prior run's settle must not swallow the next overlapping turn's prose.
			const finishesActive = finishesActiveRun(state, event.turnId);
			const patched = patchAssistant(
				{
					...state,
					activeRunId: finishesActive ? undefined : state.activeRunId,
					activeRunFromServer: finishesActive ? false : state.activeRunFromServer,
					awaitingCancelSettlement: false,
					approvals: state.approvals.filter(a => !a.runId),
					questions: [],
					questionBatches: state.questionBatches.filter(q => !q.runId),
					postRunTerminal: true
				},
				event.turnId,
				entry => {
					if (entry.status === 'cancelled') return entry;
					const sealed = sealOpenThinking(entry);
					const {waitState: _w, ...rest} = sealed;
					const failReason =
						!event.success && 'reason' in event && typeof event.reason === 'string'
							? event.reason.trim()
							: '';
					return {
						...rest,
						status: event.success ? 'done' : 'error',
						// Prefer settlement reason over bare Error when the model left no text.
						text: rest.text.trim() || failReason || rest.text,
						// Delegation rows (agentRunId) may outlive the chat turn (goal steps);
						// their terminal status comes from agent_call_finished, not the turn seal.
						tools: (entry.tools ?? []).map(t =>
							t.status === 'running' && !t.agentRunId
								? {...t, status: event.success ? 'success' : 'error'}
								: t
						)
					};
				}
			);
			const stillStreaming = patched.entries.some(
				e => e.role === 'assistant' && e.status === 'streaming'
			);
			const keepActive = stillStreaming && !finishesActive;
			return {
				...patched,
				postRunTerminal: !stillStreaming,
				activeRunId: keepActive ? state.activeRunId : undefined,
				activeRunFromServer: keepActive ? state.activeRunFromServer : false
			};
		}
		case 'turn_cancelled': {
			return {
				...forgetDocument(state),
				activeRunId: undefined,
				activeRunFromServer: false,
				awaitingCancelSettlement: false,
				approvals: state.approvals.filter(a => !a.runId),
				questions: [],
				questionBatches: state.questionBatches.filter(q => !q.runId),
				postRunTerminal: true,
				entries: state.entries.map(entry => {
					if (entry.role !== 'assistant') return entry;
					if (entry.status !== 'streaming' && entry.status !== 'cancelled') return entry;
					const sealed = sealOpenThinking(entry);
					const {waitState: _w, ...rest} = sealed;
					return {
						...rest,
						status: 'cancelled',
						tools: (entry.tools ?? []).map(t =>
							t.status === 'running' ? {...t, status: 'cancelled'} : t
						)
					};
				})
			};
		}
		case 'error': {
			// Host/command errors (replay, invalid command, history) also use this
			// type — do not unlock Composer. Turn settlement is turn_finished.
			return patchAssistant(state, event.turnId, entry => ({
				...entry,
				text: entry.text || event.message,
				status: 'error'
			}));
		}
		case 'dsh_tool_card': {
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
		case 'tool_started': {
			// Child-run tools (Goal step / nested subagent) ride agentRunId — body is child_work.
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
		case 'tool_output': {
			return settleParentTool(state, event, entry => ({
				...entry,
				tools: (entry.tools ?? []).map(t =>
					t.id === event.id
						? {...t, output: `${t.output ?? ''}${event.text}`}
						: t
				)
			}));
		}
		case 'tool_finished': {
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
					// generate_image etc. put the file in fields.path — surface it for previews.
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
		case 'agent_call_started': {
			const runId = event.runId ?? '';
			const goalId = eventGoalId(event);
			// L1 Goal step: chat status only — body lives on Goal drawer (child_work).
			if (goalId) {
				return upsertGoalFlowMember(state, {
					goalId,
					runId: runId || event.agentId,
					name: event.name,
					stepId: typeof event.stepId === 'string' ? event.stepId : undefined,
					status: 'running'
				});
			}
			// Subagent delegation → pseudo-tool row so the timeline shows nested activity.
			// The parent's own `call_agent` tool row (bridge renames it "agent: <name>") is
			// adopted when present instead of adding a duplicate row.
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
				// A goal-step subagent can start AFTER the chat turn sealed (goal track outlives
				// the turn). Reopening a finished entry to 'streaming' makes it a fake orphan the
				// next turn_started would seal as done — keep the sealed status.
				return entry.status === 'streaming' ? {...next, status: 'streaming'} : next;
			});
			// child_work_changed may beat agent_call_started (Hub upsert vs stream order).
			// Catch up the new row from any live drawer snapshot already in state.
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
		case 'agent_call_finished': {
			const runId = event.runId ?? '';
			const goalId = eventGoalId(event);
			if (goalId) {
				const prev = state.goalFlow?.members.find(m => sameRunId(m.runId, runId || event.agentId));
				// Do not downgrade a settled success when Goal-finish races a late false finish.
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
		case 'file_read': {
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
		case 'approval_requested': {
			const runId = event.runId ?? event.turnId ?? '';
			const entries = state.entries.map(entry => {
				if (entry.role !== 'assistant' || entry.status !== 'streaming') return entry;
				const sameRun =
					entry.turnId === runId ||
					entry.clientMessageId === runId ||
					entry.turnId === state.activeRunId ||
					entry.clientMessageId === state.activeRunId;
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
		case 'approval_resolved':
		case 'approval_expired': {
			return {
				...state,
				approvals: state.approvals.filter(a => a.id !== event.id)
			};
		}
		case 'question_requested': {
			const runId = event.runId ?? event.turnId;
			if (!runId) return state;
			// Hand control to the user: stop "streaming" chrome on the assistant row.
			// Engine run stays WaitingQuestion; Bridge turn may still be open.
			// Match host remap (turnId) or still-client-keyed rows via activeRunId.
			const entries = state.entries.map(entry => {
				if (entry.role !== 'assistant' || entry.status !== 'streaming') return entry;
				const sameRun =
					entry.turnId === runId ||
					entry.clientMessageId === runId ||
					entry.turnId === state.activeRunId ||
					entry.clientMessageId === state.activeRunId;
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
		case 'question_batch_requested': {
			const runId = event.runId ?? event.turnId ?? '';
			const entries = state.entries.map(entry => {
				if (entry.role !== 'assistant' || entry.status !== 'streaming') return entry;
				const sameRun =
					entry.turnId === runId ||
					entry.clientMessageId === runId ||
					entry.turnId === state.activeRunId ||
					entry.clientMessageId === state.activeRunId;
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
		case 'question_batch_resolved': {
			return {
				...state,
				questionBatches: state.questionBatches.filter(q => q.rpcId !== event.rpcId)
			};
		}
		case 'subagent_started': {
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
		case 'subagent_updated': {
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
		case 'subagent_finished': {
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
		case 'question_answered':
		case 'clarify_resolved': {
			return {
				...state,
				questions: state.questions.filter(q => q.id !== event.id)
			};
		}
		case 'clarify': {
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
		case 'run_cancelled':
		case 'run_done':
		case 'run_failed':
		case 'run_exhausted': {
			// Scope by runId — a superseded prior Run's terminal must not freeze the
			// live Turn (postRunTerminal would drop deltas). Pending prompts for *this*
			// runId always drop, even when there is no streaming assistant entry yet
			// (approval/question can arrive before turn_started reconciliation).
			const runId = event.runId;
			const touchesActive = Boolean(runId) && state.activeRunId === runId;
			const isFail = event.type === 'run_failed' || event.type === 'run_exhausted';
			const matchesEntry = (entry: TranscriptEntry): boolean =>
				Boolean(runId) && (entry.turnId === runId || entry.clientMessageId === runId);
			// Failures must seal even after the row was mis-closed as `done` (FailRun
			// after the stream died). Success/cancel still only touch the live stream.
			const sealsEntry = (entry: TranscriptEntry): boolean =>
				entry.role === 'assistant' &&
				entry.messageType !== 'goal_step_conclusion' &&
				entry.messageType !== 'goal_outcome' &&
				(isFail
					? entry.status !== 'cancelled' &&
						(matchesEntry(entry) || (touchesActive && entry.status === 'streaming'))
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
						activeRunId: state.activeRunId === runId ? undefined : state.activeRunId,
						activeRunFromServer: state.activeRunId === runId ? false : state.activeRunFromServer,
						postRunTerminal: true,
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
					// Failures: the exception is the card body. Keep prior prose only when
					// the event carried no error text (exhausted/cancel reasons may be empty).
					text: isFail && failText ? failText : (rest.text.trim() || failText || rest.text),
					fault: event.type === 'run_failed' ? keepFault(rest.fault, event.fault) : rest.fault,
					tools: (entry.tools ?? []).map(t =>
						t.status === 'running' ? {...t, status: toolStatus} : t
					)
				};
			});
			const stillStreaming = entries.some(
				e => e.role === 'assistant' && e.status === 'streaming'
			);
			return {
				...forgetDocument(state, runId),
				activeRunId: state.activeRunId === runId ? undefined : state.activeRunId,
				activeRunFromServer: state.activeRunId === runId ? false : state.activeRunFromServer,
				// Only arm straggler guard when this settle closed the last streaming row.
				postRunTerminal: stillStreaming ? false : hasMatch ? true : state.postRunTerminal,
				approvals: nextApprovals,
				questions: nextQuestions,
				questionBatches: nextBatches,
				entries
			};
		}
		case 'proc_updated': {
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
		case 'background_task_output': {
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
		case 'background_task_completed': {
			const procId = event.procId?.trim();
			if (!procId) return state;
			return {...state, liveProcs: (state.liveProcs ?? []).filter(p => p.procId !== procId)};
		}
		case 'task_updated': {
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
		case 'child_work_changed': {
			// Unified LiveChildWork wire (workload-capability): one lifecycle signal
			// for run/proc/goal/fire. Goal + proc rows stay on their richer surfaces.
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
			// Unified card feed (workload-capability.md): the Subagent card row keyed by this
			// run gets its body from the engine-side rolling outputPreview and settles from
			// the terminal child_work status — one wire for drawer and card alike.
			// L1 Goal steps do not own a chat Subagent body card.
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
		case 'message_patched': {
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
		case 'plan_build_submitted': {
			return applyPlanBuildSubmitted(state, {
				messageId: event.messageId,
				planId: event.planId,
				content: event.content ?? '',
				name: event.name ?? '',
				runId: event.runId
			});
		}
		default:
			return state;
	}
}

/** Peer / stream path: bind PlanBuild fields onto the execute-turn user row. */
function applyPlanBuildSubmitted(
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
		activeRunId: runId || state.activeRunId,
		activeRunFromServer: Boolean(runId) || state.activeRunFromServer,
		postRunTerminal: false,
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

	// create (or first sight of replace/update): attach to matching / streaming / last assistant
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

	// Orphan plan (e.g. patch before turn reconcile) — standalone assistant row.
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
			if (e.turnId === turnId || e.clientMessageId === turnId) return i;
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

function clearWaitState(entry: TranscriptEntry): TranscriptEntry {
	if (!entry.waitState) return entry;
	const {waitState: _removed, ...rest} = entry;
	return rest;
}

/** Scope segment ids by entry so VirtualTranscript keys (`assistant-${id}`) stay unique across turns. */
function nextSegmentId(entryId: string, segments: EntrySegment[], prefix: string): string {
	return `seg-${prefix}-${entryId}-${segments.length}`;
}

function entriesFromRestoredTurns(
	turns: Array<{
		turnId: string;
		userText: string;
		assistantText: string;
		thinking?: string | null;
		tools?: Array<{
			id: string;
			tool: string;
			args?: Record<string, string> | null;
			status: string;
			summary?: string | null;
		}> | null;
		steps?: Parameters<typeof restoreSegmentsFromTurn>[0]['steps'];
		origin?: string | null;
		userMessageType?: string | null;
		planId?: string | null;
		planName?: string | null;
		assistantMessageType?: string | null;
		goalId?: string | null;
		goalStatus?: string | null;
		goalStepId?: string | null;
		goalAgentName?: string | null;
		goalVerdict?: string | null;
		failed?: boolean | null;
	}>,
	skipUserTexts?: Set<string>
): TranscriptEntry[] {
	const restoredEntries: TranscriptEntry[] = [];
	for (const rt of turns) {
		const goalMsg =
			rt.assistantMessageType === 'goal_step_conclusion' ||
			rt.assistantMessageType === 'goal_outcome'
				? rt.assistantMessageType
				: null;
		if (goalMsg) {
			const verdictRaw = rt.goalVerdict?.trim().toLowerCase() ?? '';
			const verdict =
				verdictRaw === 'pass' || verdictRaw === 'reject' ? verdictRaw : undefined;
			restoredEntries.push({
				id: `assistant-${rt.turnId}`,
				role: 'assistant',
				text: rt.assistantText,
				reasoning: '',
				status: 'done',
				turnId: rt.turnId,
				messageType: goalMsg,
				...(rt.goalAgentName?.trim() ? {goalAgentName: rt.goalAgentName.trim()} : {}),
				...(verdict ? {goalVerdict: verdict} : {}),
				...(rt.goalId?.trim() ? {goalId: rt.goalId.trim()} : {}),
				...(rt.goalStepId?.trim() ? {goalStepId: rt.goalStepId.trim()} : {}),
				...(rt.goalStatus?.trim() ? {goalStatus: rt.goalStatus.trim()} : {})
			});
			continue;
		}
		const failed = rt.failed === true;
		const emptyAssistant = !rt.assistantText.trim();
		if (emptyAssistant && !failed && skipUserTexts?.has(rt.userText)) continue;
		const planBuild =
			rt.userMessageType === 'plan_build' && rt.planId
				? {
						messageType: 'plan_build' as const,
						planId: rt.planId,
						planName: rt.planName?.trim() || undefined
					}
				: null;
		const userText =
			rt.userText ||
			(planBuild ? planBuildDisplayContent(rt.planName ?? '', rt.planId!) : '');
		if (userText) {
			const origin = rt.origin?.trim() || undefined;
			restoredEntries.push({
				id: `user-${rt.turnId}`,
				role: 'user',
				text: userText,
				status: 'done',
				turnId: rt.turnId,
				...(origin ? {origin} : {}),
				...(planBuild ?? {})
			});
		}
		restoredEntries.push({
			id: `assistant-${rt.turnId}`,
			role: 'assistant',
			text: rt.assistantText,
			reasoning: rt.thinking ?? '',
			status: failed ? 'error' : 'done',
			turnId: rt.turnId,
			tools: (rt.tools ?? []).map(t => ({
				id: t.id,
				tool: t.tool,
				args: t.args ?? undefined,
				output: normalizeToolOutput(t.summary ?? ''),
				status: t.status === 'failed' || t.status === 'error' ? 'error' : 'success'
			})),
			segments: restoreSegmentsFromTurn(rt)
		});
	}
	return restoredEntries;
}

/** Cold/settled restore: history is done and no assistant is still streaming. */
function settledAttachReplay(state: TranscriptState): boolean {
	return Boolean(state.postRunTerminal) && !state.entries.some(e => e.status === 'streaming');
}

/** Persist prompt replay after settle must paint the card, but must not re-arm Stop. */
function armRunIfLive(
	state: TranscriptState,
	runId: string
): Pick<TranscriptState, 'activeRunId' | 'activeRunFromServer'> {
	if (settledAttachReplay(state)) {
		return {activeRunId: state.activeRunId, activeRunFromServer: state.activeRunFromServer};
	}
	return {
		activeRunId: runId || state.activeRunId,
		activeRunFromServer: runId ? true : state.activeRunFromServer
	};
}

/** Opener belongs to a Turn the transcript already shows — by id, or by repeating
 *  a prompt that came from the restore snapshot (persist ids differ from snapshot ids). */
function isKnownTurnOpener(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'turn_started'}>
): boolean {
	const key = event.turnId ?? event.clientMessageId ?? '';
	if (key && state.entries.some(e => e.turnId === key || e.clientMessageId === key)) {
		return true;
	}
	const text = (event.text ?? '').trim();
	if (!text) return false;
	return (state.restoredPromptTexts ?? []).includes(text);
}

/** Attach replay of a finished chat turn — not a live Goal notice or a new user submit. */
function isAttachReplayChatOpener(event: BridgeEvent): boolean {
	if (event.type !== 'turn_started') return false;
	if (event.messageType === 'goal_step_conclusion' || event.messageType === 'goal_outcome') return false;
	if (event.messageType === 'plan_build') return false;
	const turn = event.turnId ?? event.clientMessageId ?? '';
	if (/^goal-.+-notice$/.test(turn) || /^goal-step-.+-conclusion$/.test(turn)) return false;
	if (typeof event.eventSeq === 'number' && event.eventSeq > 0) return true;
	return isRiverTurnStarted(event);
}

/** Persist/river TurnStarted: empty text, not a user/plan/goal opener. */
function isRiverTurnStarted(
	event: BridgeEvent
): event is Extract<BridgeEvent, {type: 'turn_started'}> {
	if (event.type !== 'turn_started') return false;
	if ((event.text ?? '').trim()) return false;
	if (event.messageType === 'plan_build') return false;
	if (event.messageType === 'goal_step_conclusion' || event.messageType === 'goal_outcome')
		return false;
	const turn = event.turnId ?? event.clientMessageId ?? '';
	if (/^goal-.+-notice$/.test(turn) || /^goal-step-.+-conclusion$/.test(turn)) return false;
	return true;
}

/** River TurnStarted has the engine run id and empty text — remap onto the live optimistic turn. */
function riverEchoAssistant(state: TranscriptState, event: BridgeEvent): TranscriptEntry | undefined {
	if (event.type !== 'turn_started') return undefined;
	if ((event.text ?? '').trim()) return undefined;
	if (event.clientMessageId) return undefined;
	if (event.messageType === 'plan_build') return undefined;
	if (!state.activeRunId) return undefined;
	return state.entries.find(
		e =>
			e.role === 'assistant' &&
			e.status === 'streaming' &&
			!e.messageType &&
			(e.turnId === state.activeRunId || e.clientMessageId === state.activeRunId)
	);
}

/** Close a superseded stream without calling it cancelled (no Stop / no engine abort). */
function sealStreamingAsDone(entry: TranscriptEntry): TranscriptEntry {
	const sealed = sealOpenThinking(entry);
	const {waitState: _w, ...rest} = sealed;
	return {
		...rest,
		status: 'done',
		sealedUnconfirmed: true,
		text: rest.text || '',
		// Delegation rows (agentRunId) stay running: a goal-step subagent outlives the
		// chat turn and settles via its own agent_call_finished patch.
		tools: (entry.tools ?? []).map(t =>
			t.status === 'running' && !t.agentRunId ? {...t, status: 'success' as const} : t
		)
	};
}

function sealOpenThinking(entry: TranscriptEntry, at: number = Date.now()): TranscriptEntry {
	const segments = entry.segments ?? [];
	if (!segments.some(s => s.kind === 'thinking' && s.sealedAt == null)) return entry;
	return {
		...entry,
		segments: segments.map(segment =>
			segment.kind === 'thinking' && segment.sealedAt == null
				? {...segment, sealedAt: at}
				: segment
		)
	};
}

function pushThinkingSegment(entry: TranscriptEntry, text: string): TranscriptEntry {
	if (!text) return {...entry, status: 'streaming'};
	const now = Date.now();
	const segments = entry.segments ?? [];
	const last = segments.at(-1);
	const reasoning = `${entry.reasoning ?? ''}${text}`;
	if (last?.kind === 'thinking' && last.sealedAt == null) {
		return {
			...entry,
			reasoning,
			status: 'streaming',
			segments: segments.map((segment, index) =>
				index === segments.length - 1 && segment.kind === 'thinking'
					? {...segment, text: segment.text + text}
					: segment
			)
		};
	}
	return {
		...entry,
		reasoning,
		status: 'streaming',
		segments: [
			...segments,
			{
				kind: 'thinking',
				id: nextSegmentId(entry.id, segments, 'th'),
				text,
				startedAt: now
			}
		]
	};
}

function pushAssistantSegment(entry: TranscriptEntry, text: string, unitId?: string): TranscriptEntry {
	if (!text) return entry.status === 'streaming' ? {...entry, status: 'streaming'} : entry;
	if (entry.status === 'cancelled') return entry;
	// Empty settled row: seed prose without relighting Stop (approval-pause rows
	// already have text and must keep the reopen-to-streaming path below).
	if (entry.status !== 'streaming' && !entry.text.trim()) {
		const segments = entry.segments ?? [];
		return {
			...entry,
			text,
			segments: [
				...segments,
				{kind: 'assistant', id: nextSegmentId(entry.id, segments, 'a'), text, unitId}
			]
		};
	}
	// Guard against engine re-emitting the full answer as one delta.
	if (entry.text.length > 0 && text === entry.text) {
		return {...entry, status: 'streaming'};
	}
	const sealed = sealOpenThinking(entry);
	const segments = sealed.segments ?? [];
	const last = segments.at(-1);
	const sameUnit =
		last?.kind === 'assistant' &&
		(unitId == null || last.unitId == null || last.unitId === unitId);
	if (sameUnit && last?.kind === 'assistant') {
		return {
			...sealed,
			text: sealed.text + text,
			status: 'streaming',
			segments: segments.map((segment, index) =>
				index === segments.length - 1 && segment.kind === 'assistant'
					? {...segment, text: segment.text + text, unitId: segment.unitId ?? unitId}
					: segment
			)
		};
	}
	return {
		...sealed,
		text: sealed.text + text,
		status: 'streaming',
		segments: [
			...segments,
			{kind: 'assistant', id: nextSegmentId(entry.id, segments, 'a'), text, unitId}
		]
	};
}

function applyCheckpoint(entry: TranscriptEntry, unitId: string, content: string): TranscriptEntry {
	if (entry.status !== 'streaming') {
		if (entry.status === 'cancelled' || entry.text.trim() || !content) return entry;
		const segments = entry.segments ?? [];
		return {
			...entry,
			text: content,
			segments: [
				...segments,
				{kind: 'assistant', id: nextSegmentId(entry.id, segments, 'a'), text: content, unitId}
			]
		};
	}
	const sealed = sealOpenThinking(entry);
	const segments = [...(sealed.segments ?? [])];
	let idx = -1;
	for (let i = segments.length - 1; i >= 0; i--) {
		const s = segments[i];
		if (s.kind === 'assistant' && s.unitId === unitId) {
			idx = i;
			break;
		}
	}
	if (idx >= 0) {
		segments[idx] = {kind: 'assistant', id: (segments[idx] as {id: string}).id, text: content, unitId};
	} else {
		segments.push({kind: 'assistant', id: nextSegmentId(entry.id, segments, 'a'), text: content, unitId});
	}
	const text = segments.filter(s => s.kind === 'assistant').map(s => (s.kind === 'assistant' ? s.text : '')).join('');
	return {...sealed, text, status: 'streaming', segments};
}

function markStreamIncomplete(state: TranscriptState): TranscriptState {
	let changed = false;
	const entries = state.entries.map(entry => {
		if (entry.role !== 'assistant' || entry.status !== 'streaming' || entry.streamIncomplete) return entry;
		changed = true;
		return {...entry, streamIncomplete: true};
	});
	return changed ? {...state, entries} : state;
}

function pushToolSegment(entry: TranscriptEntry, tool: ToolCallView): TranscriptEntry {
	const existing = entry.tools ?? [];
	if (existing.some(t => t.id === tool.id)) {
		return {
			...entry,
			tools: existing.map(t => (t.id === tool.id ? tool : t))
		};
	}
	const sealed = sealOpenThinking(entry);
	const tools = [...(sealed.tools ?? []), tool];
	const segments = sealed.segments ?? [];
	const last = segments.at(-1);
	if (last?.kind === 'tools') {
		return {
			...sealed,
			tools,
			segments: segments.map((segment, index) =>
				index === segments.length - 1 && segment.kind === 'tools'
					? {...segment, toolIds: [...segment.toolIds, tool.id]}
					: segment
			)
		};
	}
	return {
		...sealed,
		tools,
		segments: [
			...segments,
			{kind: 'tools', id: nextSegmentId(entry.id, segments, 't'), toolIds: [tool.id]}
		]
	};
}

function restoreSegmentsFromTurn(rt: {
	turnId: string;
	assistantText: string;
	thinking?: string | null;
	tools?: Array<{id: string}> | null;
	steps?: Array<{
		reasoning?: string | null;
		tools?: Array<{id: string}> | null;
		text?: string | null;
		textBeforeTools?: boolean | null;
		/** Session Plan from Bridge restore (`message_type=plan`). */
		plan?: {
			planId: string;
			name?: string | null;
			overview?: string | null;
			todos?: Array<{id?: string; content?: string; status?: string}> | null;
			body?: string | null;
			payloadJson?: string | null;
		} | null;
	}> | null;
}): EntrySegment[] {
	const steps = rt.steps ?? [];
	if (steps.length > 0) {
		const segments: EntrySegment[] = [];
		for (const [index, step] of steps.entries()) {
			if (step.reasoning?.trim()) {
				segments.push({
					kind: 'thinking',
					id: `seg-th-${rt.turnId}-${index}`,
					text: step.reasoning,
					sealedAt: 0
				});
			}
			const toolIds = (step.tools ?? []).map(t => t.id);
			const text = step.text?.trim() ? step.text : undefined;
			const pushTools = () => {
				if (toolIds.length === 0) return;
				segments.push({
					kind: 'tools',
					id: `seg-t-${rt.turnId}-${index}`,
					toolIds
				});
			};
			const pushText = () => {
				if (!text) return;
				segments.push({
					kind: 'assistant',
					id: `seg-a-${rt.turnId}-${index}`,
					text
				});
			};
			const pushPlan = () => {
				const plan = step.plan
					? planFromWire({
							planId: step.plan.planId,
							name: step.plan.name,
							overview: step.plan.overview,
							todos: step.plan.todos,
							body: step.plan.body,
							payloadJson: step.plan.payloadJson
						})
					: null;
				if (!plan) return;
				segments.push({
					kind: 'plan',
					id: `seg-plan-${plan.planId}`,
					plan
				});
			};
			if (step.textBeforeTools) {
				pushText();
				pushTools();
			} else {
				pushTools();
				pushText();
			}
			// Plan card after thin upsert_plan tool ack in the same step (not from tool_result body).
			pushPlan();
		}
		return segments;
	}
	return restoreSegments(rt.turnId, rt.assistantText, rt.tools ?? [], rt.thinking ?? undefined);
}

function restoreSegments(
	turnId: string,
	assistantText: string,
	tools: Array<{id: string}>,
	thinking?: string
): EntrySegment[] {
	const segments: EntrySegment[] = [];
	if (thinking?.trim()) {
		segments.push({
			kind: 'thinking',
			id: `seg-th-${turnId}`,
			text: thinking,
			sealedAt: 0
		});
	}
	if (tools.length > 0) {
		segments.push({
			kind: 'tools',
			id: `seg-t-${turnId}`,
			toolIds: tools.map(t => t.id)
		});
	}
	if (assistantText.trim()) {
		segments.push({
			kind: 'assistant',
			id: `seg-a-${turnId}`,
			text: assistantText
		});
	}
	return segments;
}

function subagentRunIdOf(event: {agentRunId?: string | null}): string | undefined {
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

/**
 * Wire `child_work_changed.id` is a WorkId (`run:<uuid>`); `agent_call_*` stores the bare
 * uuid on `tool.agentRunId`. Normalize both forms before matching.
 */
function bareRunId(id: string): string {
	return id.startsWith('run:') ? id.slice(4) : id;
}

function sameRunId(a: string | undefined, b: string): boolean {
	if (!a) return false;
	return a === b || bareRunId(a) === bareRunId(b);
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
function patchSubagentRowFromChildWork(
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

function finishesActiveRun(state: TranscriptState, turnId: string | undefined): boolean {
	if (!turnId) return true;
	if (!state.activeRunId) return true;
	if (state.activeRunId === turnId) return true;
	return state.entries.some(
		e =>
			e.role === 'assistant' &&
			(e.turnId === turnId || e.clientMessageId === turnId) &&
			(e.turnId === state.activeRunId || e.clientMessageId === state.activeRunId)
	);
}

function fillsEmptyAssistant(state: TranscriptState, event: BridgeEvent): boolean {
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

/** Same chat turn, sealed for approval / user-wait — resume instead of a second card. */
function resumeSealedAssistant(
	state: TranscriptState,
	event: BridgeEvent
): TranscriptEntry | undefined {
	if (state.postRunTerminal) return undefined;
	if (event.type !== 'turn_started') return undefined;
	if (event.messageType === 'plan_build') return undefined;
	if (event.messageType === 'goal_step_conclusion' || event.messageType === 'goal_outcome')
		return undefined;
	for (let i = state.entries.length - 1; i >= 0; i -= 1) {
		const e = state.entries[i]!;
		if (e.role !== 'assistant' || e.status !== 'done' || e.messageType) continue;
		const sameClient =
			Boolean(event.clientMessageId) &&
			(e.clientMessageId === event.clientMessageId || e.turnId === event.clientMessageId);
		const sameTurn =
			Boolean(event.turnId) && (e.turnId === event.turnId || e.clientMessageId === event.turnId);
		if (sameClient || sameTurn) return e;
	}
	return undefined;
}

/** Settled attach must not replace a painted body with a thinking-only restore. */
function keepLiveProse(restored: TranscriptEntry[], live: TranscriptEntry[]): TranscriptEntry[] {
	return restored.map(entry => {
		if (entry.role !== 'assistant' || entry.text.trim()) return entry;
		const src = [...live].reverse().find(
			e =>
				e.role === 'assistant' &&
				e.status !== 'cancelled' &&
				e.text.trim() &&
				(e.turnId === entry.turnId ||
					e.clientMessageId === entry.turnId ||
					(entry.clientMessageId &&
						(e.turnId === entry.clientMessageId || e.clientMessageId === entry.clientMessageId)))
		);
		if (!src) return entry;
		const hasAssistantSeg = (entry.segments ?? []).some(
			s => s.kind === 'assistant' && s.text.trim()
		);
		return {
			...entry,
			text: src.text,
			reasoning: entry.reasoning?.trim() ? entry.reasoning : src.reasoning,
			segments: hasAssistantSeg
				? entry.segments
				: src.segments && src.segments.length > 0
					? src.segments
					: entry.segments
		};
	});
}

function hydrateLiveAssistant(
	live: TranscriptEntry,
	turns: Parameters<typeof entriesFromRestoredTurns>[0]
): TranscriptEntry {
	if (live.text.trim()) return live;
	const rt = turns.find(
		t => t.turnId === live.turnId || t.turnId === live.clientMessageId
	);
	if (!rt?.assistantText.trim()) return live;
	const seeded = entriesFromRestoredTurns([rt]).find(e => e.role === 'assistant');
	if (!seeded) return live;
	return {
		...live,
		text: seeded.text,
		reasoning: live.reasoning?.trim() ? live.reasoning : seeded.reasoning,
		segments: live.segments && live.segments.length > 0 ? live.segments : seeded.segments,
		tools: live.tools && live.tools.length > 0 ? live.tools : seeded.tools
	};
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

function patchAssistant(
	state: TranscriptState,
	turnId: string | undefined,
	update: (entry: TranscriptEntry) => TranscriptEntry
): TranscriptState {
	const card = documentCard(state, turnId);
	if (!card) return state;
	return {
		...state,
		entries: state.entries.map(entry => (entry === card ? update(entry) : entry))
	};
}
