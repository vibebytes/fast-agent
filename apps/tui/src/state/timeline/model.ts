export type TimelineItemKind =
	| 'user_message'
	| 'assistant_message'
	| 'thinking_message'
	| 'tool_group'
	| 'system_message'
	| 'error_message'
	| 'question_message'
	| 'approval_message'
	| 'task_event'
	| 'agent_call';

export type TimelineItemBase = {
	id: string;
	turnId?: string;
	runId?: string;
	kind: TimelineItemKind;
	timestamp?: number;
	compact?: boolean;
	pending?: boolean;
};

export type UserTimelineItem = TimelineItemBase & {
	kind: 'user_message';
	text: string;
};

export type AssistantTimelineItem = TimelineItemBase & {
	kind: 'assistant_message';
	text: string;
	streaming?: boolean;
	/** Intermediate narration before a tool/next step, not the final answer. */
	narration?: boolean;
	/** Continuation chunk of a split message: indent without the ✦ prefix. */
	continuation?: boolean;
};

export type ThinkingTimelineItem = TimelineItemBase & {
	kind: 'thinking_message';
	text: string;
	running?: boolean;
	/** Collapse reasoning to a single summary line (expandable via Ctrl+O). */
	collapsed?: boolean;
	/** Show only the running spinner, hide reasoning body (off mode). */
	hideBody?: boolean;
	/** ADR-0005: replaces "Thinking" while reconnecting / waiting for network. */
	waitLabel?: string;
};

export type ToolGroupTimelineItem = TimelineItemBase & {
	kind: 'tool_group';
	tools: import('../../state/model.js').ToolRun[];
	expanded?: boolean;
};

export type SystemTimelineItem = TimelineItemBase & {
	kind: 'system_message';
	text: string;
	variant?: 'notice' | 'command_result';
	commandName?: string;
	commandStatus?: string;
	capability?: string;
	availability?: import('../../state/model.js').CommandAvailability;
	/** Secondary dimmed line (raw fault detail). */
	detail?: string;
	/** When true, CommandResultMessage shows summary only (menu folded). */
	collapsed?: boolean;
};

export type ErrorTimelineItem = TimelineItemBase & {
	kind: 'error_message';
	text: string;
};

export type QuestionTimelineItem = TimelineItemBase & {
	kind: 'question_message';
	question: import('../../state/model.js').UserQuestion;
};

export type ApprovalTimelineItem = TimelineItemBase & {
	kind: 'approval_message';
	approval: import('../../state/model.js').Approval;
};

export type TaskEventTimelineItem = TimelineItemBase & {
	kind: 'task_event';
	eventType: 'run_done' | 'run_failed' | 'run_cancelled' | 'run_exhausted' | 'task_done' | 'task_failed' | 'task_cancelled' | 'agent_final_answer';
	text: string;
	success?: boolean;
};

export type AgentCallTimelineItem = TimelineItemBase & {
	kind: 'agent_call';
	agentId: string;
	name: string;
	depth: number;
	status: 'running' | 'success' | 'failed';
	currentTool?: string;
	toolCalls: number;
	/** Failure/cancellation reason shown under the row on ✗ rows. */
	detail?: string;
	elapsedMs?: number;
	tokensUsed?: number;
	/** When the delegation started; drives the live elapsed display while running. */
	startedAt?: number;
	/** First line of the child's final answer, shown under the ✓ row. */
	resultSummary?: string;
	/** Tree connector for this row (e.g. "│  ├─ "), computed by the adapter. */
	treePrefix?: string;
	/** Continuation indent for the detail/summary line under this row. */
	summaryIndent?: string;
	/** Present on the synthesized parent row heading ≥2 sibling delegations. */
	trunk?: {total: number; running: number; failed: number};
	/** A re-delegation after a failed run of the same agent under the same parent. */
	isRetry?: boolean;
};

export type TimelineItem =
	| UserTimelineItem
	| AssistantTimelineItem
	| ThinkingTimelineItem
	| ToolGroupTimelineItem
	| SystemTimelineItem
	| ErrorTimelineItem
	| QuestionTimelineItem
	| ApprovalTimelineItem
	| TaskEventTimelineItem
	| AgentCallTimelineItem;

export type TimelineState = {
	items: TimelineItem[];
	activeTurnId?: string;
};

export const initialTimelineState: TimelineState = {
	items: [],
	activeTurnId: undefined
};
