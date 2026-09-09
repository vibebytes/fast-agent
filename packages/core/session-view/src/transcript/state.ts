import type {PlanView} from '../plan.js';
import {IDLE_RUN_CHROME, type RunChrome} from '../runChrome.js';

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

/** Token/cost buckets from `usage_reported` (Bridge DSH delta). */
export type UsageView = {
	runId: string;
	turnId?: string;
	/** Named counters (input/output/cached/…); values are engine-reported longs. */
	buckets: Record<string, number>;
	/** Free-form raw fields the engine attached (model, provider, …). */
	raw?: Record<string, string>;
};

/** One `context_pruned` notice — ids dropped from the model window. */
export type ContextPruneView = {
	runId: string;
	prunedIds: string[];
	reason: string;
	remainingTokens?: number;
};

/** Rolling child transcript tail from `child_transcript_delta` (per child session). */
export type ChildTranscriptView = {
	childSessionId: string;
	/** Highest childSeq applied — out-of-order deltas below this are dropped. */
	lastSeq: number;
	/** Engine entry kind of the last applied delta (message / tool_started / …). */
	entryKind?: string;
	/** Display text tail rendered from payloadJson (replace semantics are engine-side). */
	text: string;
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

/** Context injected into the model by the engine (recall / plugin snapshot), not typed by the user. */
export type ContextInjectionView = {
	id: string;
	runId: string;
	sourceKind: string;
	form: string;
	label: string;
	text: string;
};

export type TranscriptState = {
	entries: TranscriptEntry[];
	approvals: PendingApproval[];
	questions: PendingQuestion[];
	questionBatches: PendingQuestionBatch[];
	/** DSH child Work cards. Optional on old IPC/cache snapshots. */
	subagents: TranscriptSubagent[];
	/** Engine-injected context rows (context_injected); absent when the engine injects nothing. */
	contextInjections?: ContextInjectionView[];
	/** Stop-chrome lifecycle (CONTEXT.md → RunChrome): idle / active / cancelPending / sealedRun / settled. */
	chrome: RunChrome;
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
	/** Last run_state replica from the engine (lease / attach snapshot). */
	runLease?: {
		runId?: string;
		state: 'running' | 'waiting' | 'cancelling' | 'idle';
	};
	/** True after at least one run_state for the current run — enables TTL. */
	leaseAware?: boolean;
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
	/** Latest `usage_reported` buckets for the active run (token/cost footer). */
	usage?: UsageView;
	/** `context_pruned` notices for the active run (window-trim banner). */
	contextPrunes?: ContextPruneView[];
	/** Per-child rolling transcript tails from `child_transcript_delta`. */
	childTranscripts?: Record<string, ChildTranscriptView>;
};

export function createTranscriptState(): TranscriptState {
	return {
		entries: [],
		approvals: [],
		questions: [],
		questionBatches: [],
		subagents: [],
		chrome: IDLE_RUN_CHROME,
		hasMoreOlder: false,
		liveProcs: [],
		liveTasks: [],
		childWork: []
	};
}

/** Oldest loaded Turn id (for FetchSessionHistory `beforeTurnId`). */
export function oldestLoadedTurnId(state: TranscriptState): string | undefined {
	for (const entry of state.entries) {
		if (entry.turnId) return entry.turnId;
	}
	return undefined;
}
