import type {
	PendingApproval,
	PendingQuestion,
	PendingQuestionBatch,
	QuestionBatchItem,
	ToolCallView,
	TranscriptEntry,
	TranscriptState,
	TranscriptSubagent
} from './transcriptProjection.js';
import type {ActivityCounts, DiffLine} from './diff.js';
import type {PlanTodoView, PlanView} from './plan.js';
import type {FileOp, ThoughtChrome} from './chrome.js';
import {engineRunId, plansById, projectEntryToTimelineItems} from './timeline/convert.js';
import {wrapProcessStacks} from './timeline/processStack.js';

export type {FileOp, NetworkWait, ThoughtChrome} from './chrome.js';
export {
	fileOp,
	formatFileOpEn,
	formatThoughtChromeEn,
	networkWaitLabel,
	thoughtChromeFrom
} from './chrome.js';

export {PROCESS_STACK_MIN_STEPS, wrapProcessStacks} from './timeline/processStack.js';
export {projectEntryToTimelineItems, plansById} from './timeline/convert.js';

export type TimelineItem =
	| {
			kind: 'user';
			id: string;
			text: string;
			isCommand: boolean;
			/**
			 * The run this message started, which is how a checkpoint is anchored back to it — the row
			 * `id` is a display key and matches nothing the daemon recorded.
			 */
			runId?: string;
			/** In-flight Turn's user prompt may show Stop (Session View). */
			showStop?: boolean;
			/** scheduler_generated when message came from a scheduled job. */
			origin?: string;
			/** Attached images for bubble thumbnails. */
			images?: Array<{mediaType: string; name?: string; dataUrl: string}>;
			/** PlanBuild dock under this user row (UI Build execution). */
			planBuild?: {
				planId: string;
				name: string;
				plan: PlanView | null;
			};
	  }
	| 		{
			kind: 'assistant';
			id: string;
			text: string;
			status: TranscriptEntry['status'];
			/**
			 * Engine run this answer belongs to (entry.turnId). The row `id` is a
			 * display key (`assistant-<runId>`) the daemon never recorded — retry /
			 * regenerate must send `runId`, never `id`.
			 */
			runId?: string;
			/** P1a structured failure info; drives the ErrorCardRow affordances. */
			fault?: TranscriptEntry['fault'];
	  }
	| {
			kind: 'plan';
			id: string;
			planId: string;
			name: string;
			overview: string;
			todos: PlanTodoView[];
			body: string;
	  }
	| {
			kind: 'thought';
			id: string;
			text: string;
			chrome: ThoughtChrome;
			/** Expanded while streaming; collapsed when sealed. */
			open: boolean;
	  }
	| {
			kind: 'exploring';
			id: string;
			summary: string;
			toolIds: string[];
			tools: Array<{
				id: string;
				tool: string;
				title: string;
				status: ToolCallView['status'];
				summary: string | null;
			}>;
			/** Expanded while receiving explore tools; collapsed when sealed. */
			open: boolean;
	  }
	| {
			/** Presentation window for consecutive sealed Thought / Exploring (ADR-0018). */
			kind: 'processStack';
			id: string;
			steps: ProcessStackStep[];
			/** Same as steps.length — collapsed summary uses `N steps`. */
			stepCount: number;
			/**
			 * Live-tip / shimmer signal while the Turn is streaming (not UI expand).
			 * Fast IDE Process Stack chrome always defaults collapsed; user toggle is local.
			 */
			open: boolean;
			/** Turn was cancelled — show a quiet label on the stack row (no standalone Cancelled). */
			cancelled?: boolean;
	  }
	| {
			kind: 'activity';
			id: string;
			summary: string;
			counts: ActivityCounts;
	  }
	| {
			kind: 'tool';
			id: string;
			tool: string;
			status: ToolCallView['status'];
			/** Header label (description or short command). */
			title: string;
			/** Shell command without leading `$`, if any. */
			command: string | null;
			/** Captured stdout/stderr (or other tool output). */
			output: string | null;
			/** Process exit code when Bridge provides it. */
			exitCode: string | null;
			/** Legacy one-line body preview. */
			summary: string | null;
			/** Epoch ms when tool started running (for elapsed UI). */
			startedAt?: number;
			/** Live wait/retry note from the workload wire (running subagent rows). */
			statusNote?: string;
			dshCard?: ToolCallView['dshCard'];
	  }
	| {
			kind: 'file';
			id: string;
			path: string;
			op: FileOp;
			status: ToolCallView['status'];
			add: number;
			del: number;
			/** Preview lines for inline diff card (cli-ink style). */
			lines: DiffLine[];
			hidden: number;
	  }
	| {
			kind: 'approval';
			id: string;
			tool: string;
			description: string;
			risk?: string;
			context?: string;
			note?: string;
	  }
	| {
			kind: 'question';
			id: string;
			title?: string;
			question: string;
			options: Array<{id: string; label: string; description?: string}>;
			allowCustom: boolean;
	  }
	| {
			kind: 'question_batch';
			id: string;
			questions: QuestionBatchItem[];
	  }
	| {
			kind: 'subagent';
			id: string;
			childSessionId: string;
			mode: 'one-shot' | 'continuable';
			label: string;
			activity: 'running' | 'inactive';
			status?: 'completed' | 'failed' | 'cancelled';
			summary?: string;
			preview?: string;
	  }
	| {kind: 'system'; id: string; text: string; tone: 'info' | 'error' | 'cancelled'}
	| {
			/** Compact Goal/member status in message-flow order (not a Subagent body card). */
			kind: 'goalFlow';
			id: string;
			goalId: string;
			phase: string;
			/** Goal row status when phase=finished (`passed` / `failed` / …). */
			status?: string;
			label: string;
			members: Array<{name: string; status: string; stepId?: string}>;
	  }
	| {
			/** L1 Goal step conclusion — tags rendered with i18n in the host. */
			kind: 'goalStepConclusion';
			id: string;
			agentName: string;
			verdict?: 'pass' | 'reject';
			goalId?: string;
			stepId?: string;
			text: string;
			status: TranscriptEntry['status'];
	  }
	| {
			/** Goal finished notice — outcome tag + optional summary body. */
			kind: 'goalOutcome';
			id: string;
			goalId: string;
			goalStatus: string;
			text: string;
			status: TranscriptEntry['status'];
	  }
	| {
			/** Engine-injected context (recall / plugin snapshot) — collapsed, never a user bubble. */
			kind: 'contextInjection';
			id: string;
			runId: string;
			sourceKind: string;
			form: string;
			label: string;
			text: string;
	  };

/** Sealed Thought / Exploring rows that may form a Process Stack. */
export type ProcessStackStep =
	| Extract<TimelineItem, {kind: 'thought'}>
	| Extract<TimelineItem, {kind: 'exploring'}>
	| Extract<TimelineItem, {kind: 'tool'}>;

export type TimelineOptions = {
	/** Optional map of toolId/path → diff preview for file cards. */
	fileDiffs?: Record<string, string | undefined>;
	/** @deprecated File cards pass full diffs; collapse/expand is handled in the UI (default 5 lines). */
	diffLineBudget?: number;
	/**
	 * P1b rerun provenance: victim runId → superseding turn id. Victim answers /
	 * tool traces are hidden (D10 direct replace) so the new answer takes their
	 * place with no provenance banner.
	 */
	rerunMarkers?: Record<string, string>;
	/**
	 * D10 regenerate, live channel: runIds hidden in place while the optimistic
	 * re-run streams (the wire's turn_started carries no supersedes, so the
	 * client hides the victim until restore rebuilds from the store).
	 */
	hiddenRuns?: ReadonlySet<string>;
};

/**
 * D10 stale state machine: an error card keeps its actions only while it is
 * the newest assistant terminal; once ANY later terminal (done / error /
 * cancelled) lands, the older card's buttons hide (title + details remain).
 */
/**
 * User-bubble 重新生成 is only for the last *completed* answer (D10).
 * A trailing error/cancelled/streaming assistant must not light the chip —
 * failed turns retry from the ErrorCard, not regenerate.
 */
export function regenUserIdOf(items: readonly TimelineItem[]): string | null {
	for (let i = items.length - 1; i >= 0; i--) {
		const it = items[i]!;
		if (it.kind !== 'assistant') continue;
		if (it.status !== 'done') return null;
		for (let j = i - 1; j >= 0; j--) {
			const prev = items[j]!;
			if (prev.kind === 'user' && !prev.isCommand) return prev.id;
		}
		return null;
	}
	return null;
}

export function staleErrorCardIds(items: readonly TimelineItem[]): Set<string> {
	const stale = new Set<string>();
	let pendingErrorId: string | null = null;
	for (const item of items) {
		if (item.kind !== 'assistant') continue;
		if (item.status === 'error') {
			if (pendingErrorId !== null) stale.add(pendingErrorId);
			pendingErrorId = item.id;
		} else if (item.status === 'done' || item.status === 'cancelled') {
			if (pendingErrorId !== null) {
				stale.add(pendingErrorId);
				pendingErrorId = null;
			}
		}
	}
	return stale;
}

/** Successful `goal` handshake — not step conclusions or the finish notice. */
function isGoalHandshake(it: TimelineItem): boolean {
	if (it.kind === 'tool' && it.tool === 'goal') return it.status === 'success';
	if (it.kind === 'processStack') {
		return it.steps.some(s => s.kind === 'tool' && s.tool === 'goal');
	}
	return false;
}

function isGoalWorkLog(it: TimelineItem, goalId: string): boolean {
	if (it.kind === 'goalStepConclusion') return !it.goalId || it.goalId === goalId;
	if (it.kind === 'goalOutcome') return it.goalId === goalId;
	return false;
}

/**
 * Pin Goal status chrome to the latest handshake (plan → start may move once),
 * then to assistant prose in that slice. Work-log cards and later user turns
 * stay below; failed `goal` tools are not handshakes.
 */
export function goalFlowInsertIndex(items: TimelineItem[], goalId: string): number {
	let last = -1;
	for (let i = 0; i < items.length; i++) {
		if (isGoalHandshake(items[i]!)) last = i;
	}
	if (last < 0) {
		let i = items.length;
		while (i > 0 && items[i - 1]!.kind === 'user') i -= 1;
		return i;
	}
	let at = last;
	for (let i = last + 1; i < items.length; i++) {
		const it = items[i]!;
		if (it.kind === 'user' || isGoalWorkLog(it, goalId)) break;
		if (it.kind === 'assistant' && it.text.trim()) at = i;
	}
	return at + 1;
}

/** Insert (or replace) Goal flow chrome at its message-flow anchor. */
export function placeGoalFlow(
	items: TimelineItem[],
	flow: Extract<TimelineItem, {kind: 'goalFlow'}>
): TimelineItem[] {
	const without = items.filter(
		it => !(it.kind === 'goalFlow' && it.goalId === flow.goalId)
	);
	const at = goalFlowInsertIndex(without, flow.goalId);
	return [...without.slice(0, at), flow, ...without.slice(at)];
}
/** IPC / cache snapshots may omit newer fields. */
export type TimelineSource = Pick<TranscriptState, 'entries' | 'approvals' | 'questions'> & {
	questionBatches?: TranscriptState['questionBatches'];
	subagents?: TranscriptState['subagents'];
	contextInjections?: TranscriptState['contextInjections'];
}

/**
 * Project domain transcript state into a flat TimelineItem list for shadcn binding.
 */
export function toTimelineItems(
	state: TimelineSource,
	options: TimelineOptions = {}
): TimelineItem[] {
	const rawItems: TimelineItem[] = [];
	let prevUser: TranscriptEntry | undefined;
	const planViews = plansById(state.entries);
	const markers = options.rerunMarkers ?? {};

	for (const entry of state.entries) {
		const run = engineRunId(entry);
		// D4: a superseded FAILED run keeps its error card visible (stale state
		// machine grays it once the retry terminal lands); only its answer rows hide.
		if (entry.role !== 'user' && run && markers[run] && entry.status !== 'error') continue;
		if (
			entry.role !== 'user' &&
			run &&
			entry.status !== 'error' &&
			options.hiddenRuns?.has(run)
		)
			continue;
		rawItems.push(...projectEntryToTimelineItems(entry, prevUser, {...options, planViews}));
		if (entry.role === 'user') {
			prevUser = entry;
		}
	}

	for (const approval of state.approvals ?? []) {
		rawItems.push(approvalToItem(approval));
	}
	for (const question of state.questions ?? []) {
		rawItems.push(questionToItem(question));
	}
	for (const batch of state.questionBatches ?? []) {
		rawItems.push(questionBatchToItem(batch));
	}
	for (const sub of state.subagents ?? []) {
		rawItems.push(subagentToItem(sub));
	}
	for (const injection of state.contextInjections ?? []) {
		rawItems.push(contextInjectionToItem(injection));
	}

	const activeTurn = state.entries[state.entries.length - 1]?.status === 'streaming';
	const lastEntryId = state.entries[state.entries.length - 1]?.id ?? 'global';

	return wrapProcessStacks(rawItems, {
		turnActive: activeTurn,
		entryId: lastEntryId
	});
}

function approvalToItem(approval: PendingApproval): TimelineItem {
	return {
		kind: 'approval',
		id: approval.id,
		tool: approval.tool,
		description: approval.description,
		risk: approval.risk,
		context: approval.context,
		note: approval.note
	};
}

function questionToItem(question: PendingQuestion): TimelineItem {
	return {
		kind: 'question',
		id: question.id,
		title: question.title,
		question: question.question,
		options: question.options,
		allowCustom: question.allowCustom !== false
	};
}

function questionBatchToItem(batch: PendingQuestionBatch): TimelineItem {
	return {
		kind: 'question_batch',
		id: batch.rpcId,
		questions: batch.questions
	};
}

function subagentToItem(sub: TranscriptSubagent): TimelineItem {
	return {
		kind: 'subagent',
		id: sub.childSessionId,
		childSessionId: sub.childSessionId,
		mode: sub.mode,
		label: sub.label,
		activity: sub.activity,
		status: sub.status,
		summary: sub.summary,
		preview: sub.preview
	};
}

function contextInjectionToItem(
	injection: NonNullable<TranscriptState['contextInjections']>[number]
): TimelineItem {
	return {
		kind: 'contextInjection',
		id: injection.id,
		runId: injection.runId,
		sourceKind: injection.sourceKind,
		form: injection.form,
		label: injection.label,
		text: injection.text
	};
}
