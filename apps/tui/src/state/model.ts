import {
	createTranscriptState,
	type PendingApproval,
	type PendingQuestion,
	type TranscriptState,
	type TurnTerminal
} from '@fast-ide/session-view';

export type SessionInfo = {
	id: string;
	title?: string;
	summary?: string;
	lastModified: string;
	messageCount: number;
	cwd?: string;
	isCurrent?: boolean;
};

export type RestoredTool = {
	id: string;
	tool: string;
	args?: Record<string, string>;
	status: 'success' | 'failed';
	summary?: string;
};

export type RestoredStep = {
	reasoning?: string;
	tools?: RestoredTool[];
	text?: string;
	/** When true, `text` is preamble that must render before tools. */
	textBeforeTools?: boolean;
};

export type RestoredTurn = {
	turnId: string;
	userText: string;
	assistantText: string;
	thinking?: string;
	tools?: RestoredTool[];
	tokensUsed?: number;
	/** Ordered ReAct steps when Engine expand is present. */
	steps?: RestoredStep[];
	/** User message_origin wire (e.g. scheduler_generated). */
	origin?: string;
};

export type Message = {
	id: string;
	role: 'user' | 'assistant' | 'system';
	text: string;
	/** Secondary line rendered dimmed under system text (raw fault detail). */
	detail?: string;
	kind?: 'notice' | 'command_result';
	commandName?: string;
	commandStatus?: string;
	capability?: string;
	availability?: CommandAvailability;
	/** Interactive menus (/skills list): collapse to summary after the next user/command submit. */
	collapsed?: boolean;
};

export type ToolRun = {
	id: string;
	tool: string;
	args: Record<string, string>;
	output: Array<{stream: string; text: string}>;
	status: 'running' | 'success' | 'failed' | 'denied';
	fields: Record<string, string>;
	/** When the UI saw tool_started; drives the live elapsed display while running. */
	startedAt?: number;
	expanded?: boolean;
};

export type CodeFile = {
	path: string;
	language: string;
	content: string;
	expanded: boolean;
};

/**
 * In-flight decision on an approval. `sentAt` drives the tiered feedback
 * (optimistic echo → waiting spinner → escalation), `acked` flips when the
 * engine's command_result ACK arrives, `failed` carries the rejection reason.
 */
/** Snapshot behind the Goal card / busy banner — mirrors Bridge `goal_updated`. */
export type GoalCardState = {
	goalId: string;
	phase: 'awaiting_confirm' | 'started' | 'paused' | 'escalated' | 'finished';
	status: string;
	/** Short display name (auto from statement at plan). */
	name?: string;
	statement?: string;
	acceptance?: string;
	workflowJson?: string;
	membersJson?: string;
	budgetJson?: string;
	loopAgentId?: string;
	resultSummary?: string;
	escalateActions?: string[];
	reason?: string;
	/** In-flight workflow node ids (parallel DAG cursors). */
	currentStepIds?: string[];
	activeRunIds?: string[];
	progressJson?: string;
	escalateKind?: 'infra' | 'decision';
};

export type ApprovalDecision = {
	value: 'y' | 'n' | 'a';
	sentAt: number;
	acked?: boolean;
	failed?: string;
};

export type Approval = {
	id: string;
	runId?: string;
	turnId?: string;
	tool: string;
	description: string;
	risk: string;
	context: string;
	/** When the request reached the UI; drives the "已等待 Xm" display (waits are open-ended). */
	requestedAt?: number;
	decision?: ApprovalDecision;
};

export type Clarification = {
	id: string;
	runId?: string;
	turnId?: string;
	question: string;
};

export type QuestionOption = {
	id: string;
	label: string;
	description?: string;
	recommended?: boolean;
};

export type UserQuestion = {
	id: string;
	runId?: string;
	taskId?: string;
	turnId?: string;
	title?: string;
	question: string;
	options: QuestionOption[];
	allowCustom: boolean;
	allowChat: boolean;
};

export type LlmMessageSnapshot = {role: string; content: string};

export type LlmResponseSnapshot = {reasoning: string; content: string};

export type LlmRequestSnapshot = {
	id: string;
	turn: number;
	at: string;
	messages: LlmMessageSnapshot[];
	response?: LlmResponseSnapshot;
};

export type CommandAvailability = 'ready' | 'partial' | 'capability_unavailable' | 'hidden';

export type CommandInfo = {
	name: string;
	description: string;
	usage: string;
	available: boolean;
	availability?: CommandAvailability;
	capability?: string;
};

export type FooterItemId = 'model' | 'mode' | 'cwd' | 'trust' | 'queue' | 'task' | 'tokens' | 'errors' | 'admin';

export type FooterConfig = Record<FooterItemId, boolean>;

export type QueuedInput = {
	id: string;
	text: string;
	state: 'queued' | 'sending' | 'sent' | 'failed';
	/** Structured @ chips retained across enqueue → flush. */
	mentions?: Array<{
		kind: string;
		locator: string;
		displayName?: string;
		ref?: string;
		entity?: string;
	}>;
};

export type AgentRun = {
	/** Unique per delegation. agentId repeats when the same agent is called twice. */
	runId: string;
	agentId: string;
	parentAgentId?: string;
	/** Run identity of the delegating parent; absent for top-level delegations. */
	parentRunId?: string;
	/**
	 * Concurrency batch for top-level delegations: roots started while another
	 * root was still running share its batch. A batch of ≥2 renders under one
	 * trunk row and settles as a unit (prevents torn <Static> history).
	 */
	batchId?: string;
	depth: number;
	name: string;
	status: 'running' | 'success' | 'failed';
	startedAt: number;
	elapsedMs?: number;
	tokensUsed?: number;
	toolCalls: number;
	currentTool?: string;
	/** Why the run failed / was cancelled — a bare ✗ is opaque in the transcript. */
	detail?: string;
	/** First line of the child's final answer, shown under the ✓ row. */
	resultSummary?: string;
	/** A re-delegation after a failed run of the same agent under the same parent. */
	isRetry?: boolean;
};

export type InputMode = 'starting' | 'normal' | 'running' | 'queued' | 'approval' | 'clarify' | 'question' | 'exited';

export type TurnSegment =
	| {kind: 'thinking'; id: string; text: string}
	| {kind: 'assistant'; id: string; text: string}
	| {kind: 'tools'; id: string; toolIds: string[]}
	| {kind: 'system'; id: string; messageId: string};

/**
 * Local-only turn (slash commands, notices, command_result cards).
 * Bridge / Engine content lives in `UiState.transcript`, not here.
 */
export type Turn = {
	id: string;
	clientMessageId?: string;
	/** Server-assigned UUID that may arrive after the turn is already running. */
	serverTurnId?: string;
	userText: string;
	thinking: string;
	assistantText: string;
	tools: ToolRun[];
	files: CodeFile[];
	systemMessages: Message[];
	/** Ordered record of how thinking/tool/assistant/system content actually arrived. */
	segments: TurnSegment[];
	status: 'pending' | 'running' | 'clarify' | 'success' | 'failed' | 'cancelled';
	tokensUsed: number;
	toolsExpanded?: boolean;
	/** Monotonic arrive order vs Bridge transcript entries (timeline merge). */
	streamSeq: number;
};

export type UiState = {
	ready: boolean;
	running: boolean;
	inputMode: InputMode;
	protocolVersion: number;
	/** Engine process incarnation id; a change means all engine-side waits died. */
	engineEpoch?: string;
	/** Timestamp of the last event received from the engine (heartbeat echoes included). */
	lastEngineEventAt?: number;
	capabilities: string[];
	/** Engine agent mode (normal | plan | yolo | ask) — the approval posture, distinct from inputMode. */
	agentMode: string;
	model: string;
	modelDisplay?: string;
	maxTurns: number;
	standalone: boolean;
	cwd: string;
	bridgeMode: string;
	tokensUsed: number;
	queue: QueuedInput[];
	/**
	 * Bridge Transcript projection (source of truth for Engine turns, approvals,
	 * questions, postRunTerminal, awaitingCancelSettlement).
	 */
	transcript: TranscriptState;
	/**
	 * Slash-command / notice / command_result turns that never come from Bridge.
	 */
	localTurns: Turn[];
	/** Next monotonic seq for chronological merge of transcript ↔ localTurns. */
	nextStreamSeq: number;
	/** `transcript.entries[].id` → streamSeq (assigned when the entry first appears). */
	entryStreamSeq: Record<string, number>;
	/**
	 * Host-only DecideApproval UX state (optimistic echo → ACK / failure).
	 * Merged onto `transcript.approvals` when rendering ApprovalDialog.
	 */
	approvalDecisions: Record<string, ApprovalDecision>;
	/**
	 * Goal card state (②′ gate + visibility surfaces), driven only by Bridge `goal_updated`:
	 * awaiting_confirm → confirm card; started → busy banner; escalated → escalate card;
	 * finished → completion card (dismissable).
	 */
	goalCard?: GoalCardState;
	/** Ctrl+B: route keys to the Goal card (composer keeps working when unfocused). */
	goalCardFocused: boolean;
	/** Ctrl+O: expand tool detail / thinking for the latest tool group. */
	toolsExpanded: boolean;
	orphanEvents: string[];
	debugEvents: string[];
	llmRequests: LlmRequestSnapshot[];
	debugVisible: boolean;
	debugUrl?: string;
	adminUrl?: string;
	commands: CommandInfo[];
	footerConfig: FooterConfig;
	thinkingDisplay: ThinkingDisplayMode;
	helpVisible: boolean;
	status: string;
	errors: string[];
	sessionId?: string;
	sessionTitle?: string;
	sessions: SessionInfo[];
	agentRuns: AgentRun[];
	/**
	 * Names successfully registered via define_agent in this session. Unlike
	 * agentRuns (live delegations, cleared at run end), this survives the turn
	 * so Ctrl+G can distinguish "defined but not yet called" from "none".
	 */
	definedAgents: string[];
	/**
	 * Last Turn terminal for Composer Gate auto-dequeue (`canAutoDequeue`).
	 * Cleared when a new Turn starts.
	 */
	lastTurnTerminal: TurnTerminal | null;
	/**
	 * Most recent failed run: runId + fault.acceptedTurns (null when the wire
	 * carried no structured fault). Gates /continue — a first-turn failure has
	 * nothing to continue from.
	 */
	lastFailure: {runId: string; acceptedTurns: number | null} | null;
	/**
	 * RunId of an in-flight rerun/regenerate (doc §8). Victim assistant rows
	 * (turnId === this, status !== 'error') are hidden from the timeline until
	 * session_restored lands the supersedes record or a rejection retires it.
	 */
	rerunPendingRunId: string | null;
	/** When true, auto-dequeue is suppressed (user pause; cancel also sets this). */
	queuePaused: boolean;
	agentViewStack: import('./agentViewStack.js').AgentViewStack;
	/** Drill-down timelines fetched via FetchAgentTimeline, keyed by agentId. */
	agentTimelines: Record<string, AgentTimeline>;
};

export type AgentTimeline = {
	agentId: string;
	parentAgentId?: string;
	name: string;
	turns: Array<{turnId: string; userText: string; assistantText: string}>;
	children: Array<{agentId: string; name: string}>;
};

export type ThinkingDisplayMode = 'off' | 'compact' | 'full';

export const defaultFooterConfig: FooterConfig = {
	model: true,
	mode: true,
	cwd: true,
	trust: true,
	queue: true,
	task: true,
	tokens: true,
	errors: true,
	admin: true
};

export const initialState: UiState = {
	ready: false,
	running: false,
	inputMode: 'starting',
	protocolVersion: 1,
	engineEpoch: undefined,
	lastEngineEventAt: undefined,
	capabilities: [],
	agentMode: 'normal',
	model: 'default',
	modelDisplay: undefined,
	maxTurns: 50,
	standalone: false,
	cwd: process.cwd(),
	bridgeMode: 'bridge',
	tokensUsed: 0,
	queue: [],
	transcript: createTranscriptState(),
	localTurns: [],
	nextStreamSeq: 0,
	entryStreamSeq: {},
	approvalDecisions: {},
	goalCard: undefined,
	goalCardFocused: false,
	toolsExpanded: false,
	orphanEvents: [],
	debugEvents: [],
	llmRequests: [],
	debugVisible: false,
	debugUrl: undefined,
	adminUrl: undefined,
	commands: [],
	footerConfig: defaultFooterConfig,
	thinkingDisplay: 'compact',
	helpVisible: false,
	status: 'starting',
	errors: [],
	sessionId: undefined,
	sessionTitle: undefined,
	sessions: [],
	agentRuns: [],
	definedAgents: [],
	lastTurnTerminal: null,
	lastFailure: null,
	rerunPendingRunId: null,
	queuePaused: false,
	agentViewStack: {entries: []},
	agentTimelines: {}
};

/** Merge transcript approvals with host DecideApproval UX state. */
export function approvalsFromState(state: UiState): Approval[] {
	return state.transcript.approvals.map((a: PendingApproval) => ({
		id: a.id,
		runId: a.runId,
		tool: a.tool,
		description: a.description,
		risk: a.risk ?? '',
		context: a.context ?? '',
		decision: state.approvalDecisions[a.id]
	}));
}

/** Map transcript questions to the host UserQuestion shape. */
export function questionsFromState(state: UiState): UserQuestion[] {
	return state.transcript.questions.map((q: PendingQuestion) => ({
		id: q.id,
		runId: q.runId,
		title: q.title,
		question: q.question,
		options: q.options.map(o => ({
			id: o.id,
			label: o.label,
			description: o.description
		})),
		allowCustom: q.allowCustom ?? true,
		allowChat: false
	}));
}
