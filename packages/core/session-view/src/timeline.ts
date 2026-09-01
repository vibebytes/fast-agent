import {extractQuery, parseUserSkillDisplay} from '@fastllm/bridge-protocol';
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
import {
	classifyToolActivity,
	countDiffStats,
	formatActivitySummary,
	isWriteTool,
	parseDiffWithLineNumbers,
	type ActivityCounts,
	type DiffLine
} from './diff.js';
import type {PlanTodoView, PlanView} from './plan.js';
import {fileOp, thoughtChromeFrom, type FileOp, type ThoughtChrome} from './chrome.js';
import {normalizeToolOutput} from './toolOutput.js';

export type {FileOp, NetworkWait, ThoughtChrome} from './chrome.js';
export {
	fileOp,
	formatFileOpEn,
	formatThoughtChromeEn,
	networkWaitLabel,
	thoughtChromeFrom
} from './chrome.js';

/** Minimum consecutive sealed process rows before wrapping into a Process Stack. */
export const PROCESS_STACK_MIN_STEPS = 2;

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

function isExploreLike(tool: string): boolean {
	// Subagent delegation rows ("agent: <name>") always stand alone — the agent's
	// display name must not leak into the activity classifier (e.g. "researcher").
	if (tool.startsWith('agent: ')) return false;
	const kind = classifyToolActivity(tool);
	return kind === 'explored' || kind === 'searched' || kind === 'fetched';
}

/** Last 2 path segments for Exploring chrome (avoid burying the search needle). */
function shortPath(path: string): string {
	const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
	if (parts.length <= 2) return parts.join('/') || path;
	return parts.slice(-2).join('/');
}

/** Grep / glob / find needle — pattern first, then query / glob aliases. */
function searchNeedle(args: Record<string, string>): string | undefined {
	const raw =
		args.pattern?.trim() ||
		args.query?.trim() ||
		args.glob?.trim() ||
		args.regex?.trim() ||
		args.needle?.trim();
	return raw || undefined;
}

function isSearchTool(tool: string): boolean {
	return /grep|search|glob|find/i.test(tool);
}

function formatToolArgs(tool: string, args?: Record<string, string>): string | null {
	if (!args) return null;
	if (/shell|bash|terminal|command/i.test(tool) && args.command) return `$ ${args.command}`;
	// Search: title carries the needle; summary is only the scope path.
	if (isSearchTool(tool)) {
		const path = args.path?.trim();
		if (path) return shortPath(path);
		return null;
	}
	if (args.path && Object.keys(args).length <= 2) {
		// Path-only tools already use the path as their title. When description
		// becomes the title, retain the path as useful secondary context.
		return args.description?.trim() ? args.path : null;
	}
	try {
		return JSON.stringify(args);
	} catch {
		return null;
	}
}

function toolCommand(tool: string, args?: Record<string, string>): string | null {
	if (!args) return null;
	if (/shell|bash|terminal|command/i.test(tool) && args.command) return args.command;
	return null;
}

function toolTitle(tool: string, args?: Record<string, string>): string {
	const description = args?.description?.trim();
	if (description) return description;
	const command = toolCommand(tool, args);
	if (command) {
		const oneLine = command.replace(/\s+/g, ' ').trim();
		return oneLine.length > 72 ? `${oneLine.slice(0, 69)}…` : oneLine;
	}
	if (isSearchTool(tool)) {
		const needle = searchNeedle(args ?? {});
		const kind = tool.trim().toLowerCase() || 'search';
		if (needle) return `${kind} ${needle}`;
		return kind;
	}
	if (args?.path) {
		const rawVerb = tool.toLowerCase().replace(/_file|_dir|_tool/g, '').trim();
		const verb = rawVerb || 'read';
		return `${verb} ${shortPath(args.path)}`;
	}
	return tool;
}

function pathFromTool(tool: ToolCallView): string | undefined {
	return tool.args?.path ?? tool.args?.file ?? tool.args?.filepath ?? tool.args?.file_path;
}

function resolveDiffText(
	tool: ToolCallView,
	fileDiffs: Record<string, string | undefined>
): string | undefined {
	const path = pathFromTool(tool);
	return (
		fileDiffs[tool.id] ??
		(path ? fileDiffs[path] : undefined) ??
		tool.output ??
		undefined
	);
}

function pushAssistantItems(
	items: TimelineItem[],
	entry: TranscriptEntry,
	fileDiffs: Record<string, string | undefined>,
	diffLineBudget: number
): void {
	const tools = entry.tools ?? [];
	const toolById = new Map(tools.map(t => [t.id, t]));
	const runId: {readonly runId: string} | Record<string, never> = entry.turnId
		? ({runId: entry.turnId} as const)
		: {};

	const emitExploring = (group: ToolCallView[], groupIndex: number) => {
		if (group.length === 0) return;
		const counts: ActivityCounts = {explored: 0, searched: 0, fetched: 0, edited: 0};
		for (const tool of group) {
			const kind = classifyToolActivity(tool.tool);
			if (kind !== 'other') counts[kind] += 1;
		}
		const summary = formatActivitySummary(counts) || `Explored ${group.length}`;
		const open =
			entry.status === 'streaming' && group.some(t => t.status === 'running');
		items.push({
			kind: 'exploring',
			id: `${entry.id}-exploring-${groupIndex}`,
			summary,
			toolIds: group.map(t => t.id),
			tools: group.map(t => ({
				id: t.id,
				tool: t.tool,
				title: toolTitle(t.tool, t.args),
				status: t.status,
				summary: formatToolArgs(t.tool, t.args)
			})),
			open
		});
	};

	const emitToolIds = (toolIds: string[], exploringIndex: {n: number}) => {
		let exploreBuf: ToolCallView[] = [];
		const flushExplore = () => {
			if (exploreBuf.length === 0) return;
			emitExploring(exploreBuf, exploringIndex.n);
			exploringIndex.n += 1;
			exploreBuf = [];
		};
		for (const toolId of toolIds) {
			const tool = toolById.get(toolId);
			if (!tool) continue;
			if (isExploreLike(tool.tool)) {
				exploreBuf.push(tool);
				continue;
			}
			flushExplore();
			if (isWriteTool(tool.tool)) {
				pushFileItem(items, tool, fileDiffs, diffLineBudget);
			} else {
				pushToolItem(items, tool);
			}
		}
		flushExplore();
	};

	const segments = entry.segments ?? [];
	const thinkingSegments = segments.filter(s => s.kind === 'thinking');
	const hasThinkingSegments = thinkingSegments.length > 0;
	const exploringIndex = {n: 0};
	const wait = entry.waitState;

	if (hasThinkingSegments || segments.length > 0) {
		if (!hasThinkingSegments && entry.reasoning) {
			const open = entry.status === 'streaming';
			items.push({
				kind: 'thought',
				id: `${entry.id}-thought`,
				text: entry.reasoning,
				chrome: thoughtChromeFrom(entry.reasoning, {open, wait: open ? wait : undefined}),
				open
			});
		}

		const orphanText =
			!segments.some(s => s.kind === 'assistant' && s.text.trim().length > 0) && entry.text.trim()
				? entry.text
				: '';
		let orphanEmitted = false;
		let segIdx = 0;
		for (const segment of segments) {
			const isTailSegment = segIdx === segments.length - 1;
			const segStatus = entry.status === 'streaming' && isTailSegment ? 'streaming' : 'done';
			segIdx++;

			if (segment.kind === 'thinking') {
				if (!segment.text.trim() && entry.status !== 'streaming') continue;
				const open = entry.status === 'streaming' && segment.sealedAt == null;
				items.push({
					kind: 'thought',
					id: segment.id,
					text: segment.text,
					chrome: thoughtChromeFrom(segment.text, {
						open,
						startedAt: segment.startedAt,
						sealedAt: segment.sealedAt,
						wait: open ? wait : undefined
					}),
					open
				});
				continue;
			}
			if (orphanText && !orphanEmitted && segment.kind === 'tools') {
				items.push({
					kind: 'assistant',
					id: `${entry.id}-orphan-text`,
					text: orphanText,
					status: entry.status === 'error' || entry.status === 'cancelled' ? entry.status : 'done',
					fault: entry.status === 'error' ? entry.fault : undefined,
					...runId
				});
				orphanEmitted = true;
			}
			if (segment.kind === 'assistant') {
				if (!segment.text.trim() && entry.status !== 'streaming') continue;
				items.push({
					kind: 'assistant',
					id: segment.id,
					text: segment.text,
					status: segStatus,
					...runId
				});
				continue;
			}
			if (segment.kind === 'plan') {
				items.push({
					kind: 'plan',
					id: segment.id,
					planId: segment.plan.planId,
					name: segment.plan.name,
					overview: segment.plan.overview,
					todos: segment.plan.todos,
					body: segment.plan.body
				});
				continue;
			}
			if (segment.kind === 'tools') {
				emitToolIds(segment.toolIds, exploringIndex);
			}
		}
		if (orphanText && !orphanEmitted) {
			items.push({
				kind: 'assistant',
				id: `${entry.id}-orphan-text`,
				text: orphanText,
				status: entry.status,
				fault: entry.fault,
				...runId
			});
		}
	} else {
		if (entry.reasoning) {
			const open = entry.status === 'streaming';
			items.push({
				kind: 'thought',
				id: `${entry.id}-thought`,
				text: entry.reasoning,
				chrome: thoughtChromeFrom(entry.reasoning, {open, wait: open ? wait : undefined}),
				open
			});
		}
		emitToolIds(
			tools.map(t => t.id),
			exploringIndex
		);
		if (entry.text) {
			items.push({
				kind: 'assistant',
				id: entry.id,
				text: entry.text,
				status: entry.status,
				fault: entry.fault,
				...runId
			});
		}
	}

	if (entry.status === 'error') ensureErrorAssistant(items, entry, entry.turnId);

	const hasAssistantSegment = segments.some(s => s.kind === 'assistant' && s.text.trim());
	if (
		!hasAssistantSegment &&
		!entry.text &&
		entry.status === 'streaming' &&
		!entry.reasoning &&
		tools.length === 0
	) {
		if (wait) {
			items.push({
				kind: 'thought',
				id: `${entry.id}-wait`,
				text: '',
				chrome: thoughtChromeFrom('', {open: true, wait}),
				open: true
			});
		} else {
			items.push({
				kind: 'assistant',
				id: entry.id,
				text: '',
				status: 'streaming',
				...runId
			});
		}
	}

	if (entry.status === 'cancelled') {
		items.push({
			kind: 'system',
			id: `${entry.id}-cancelled`,
			text: 'Cancelled',
			tone: 'cancelled'
		});
	} else if (entry.streamIncomplete) {
		items.push({
			kind: 'system',
			id: `${entry.id}-incomplete`,
			text: 'Incomplete stream',
			tone: 'cancelled'
		});
	} else if (entry.status === 'streaming') {
		const last = items[items.length - 1];
		if (!last) {
			items.push({
				kind: 'assistant',
				id: `${entry.id}-streaming-tail`,
				text: '',
				status: 'streaming'
			});
		}
	} else if (
		entry.status === 'error' &&
		!entry.text &&
		!hasAssistantSegment &&
		!items.some(i => i.kind === 'assistant' && i.status === 'error')
	) {
		items.push({
			kind: 'system',
			id: `${entry.id}-error`,
			text: 'Error',
			tone: 'error'
		});
	}
}

/** Failed turns must end on an error-status assistant (ErrorCard), never a done reply. */
function ensureErrorAssistant(items: TimelineItem[], entry: TranscriptEntry, turnId?: string): void {
	const failText = entry.text.trim();
	const run = turnId ? {runId: turnId} : {};
	for (let i = items.length - 1; i >= 0; i--) {
		const prev = items[i]!;
		if (prev.kind !== 'assistant') continue;
		items[i] = {
			...prev,
			status: 'error',
			text: failText || prev.text,
			fault: entry.fault ?? prev.fault,
			...run
		};
		return;
	}
	if (!failText) return;
	items.push({
		kind: 'assistant',
		id: entry.id,
		text: failText,
		status: 'error',
		fault: entry.fault,
		...run
	});
}

function pushFileItem(
	items: TimelineItem[],
	tool: ToolCallView,
	fileDiffs: Record<string, string | undefined>,
	_diffLineBudget: number
): void {
	const path = pathFromTool(tool) ?? tool.tool;
	const diffText = resolveDiffText(tool, fileDiffs);
	const parsed = diffText
		? parseDiffWithLineNumbers(
				diffText.includes('@@ ') ? diffText.replace(/^.*?(?=@@)/s, '') : diffText
			)
		: [];
	/** Cap lines kept on the Transcript card; full file opens in the editor. */
	const TRANSCRIPT_DIFF_LINE_CAP = 48;
	const display = parsed.filter(line => line.type !== 'other' && line.type !== 'hunk');
	const capped = display.slice(0, TRANSCRIPT_DIFF_LINE_CAP);
	const stats = countDiffStats(diffText);
	items.push({
		kind: 'file',
		id: tool.id,
		path,
		op: fileOp(tool.tool),
		status: tool.status,
		add: stats.add,
		del: stats.del,
		lines: capped,
		hidden: Math.max(0, display.length - capped.length)
	});
}

function pushToolItem(items: TimelineItem[], tool: ToolCallView): void {
	const output = normalizeToolOutput(tool.output);
	items.push({
		kind: 'tool',
		id: tool.id,
		tool: tool.tool,
		status: tool.status,
		title: toolTitle(tool.tool, tool.args),
		command: toolCommand(tool.tool, tool.args),
		output: output ? output : null,
		exitCode: tool.exitCode ?? tool.fields?.exit ?? tool.fields?.exit_code ?? null,
		summary: formatToolArgs(tool.tool, tool.args),
		startedAt: tool.startedAt,
		...(tool.statusNote ? {statusNote: tool.statusNote} : {}),
		...(tool.dshCard ? {dshCard: tool.dshCard} : {})
	});
}
function isSealedProcessStep(item: TimelineItem): item is ProcessStackStep {
	if (item.kind === 'thought' || item.kind === 'exploring') return !item.open;
	if (item.kind === 'tool') {
		// Successful/completed tools stack into process steps; running/failed/error tools stay visible
		return item.status === 'success';
	}
	return false;
}

function mergeAdjacentExploring(items: TimelineItem[]): TimelineItem[] {
	const result: TimelineItem[] = [];
	for (const item of items) {
		if (item.kind !== 'exploring') {
			result.push(item);
			continue;
		}
		const prev = result[result.length - 1];
		if (prev && prev.kind === 'exploring') {
			const combinedTools = [...prev.tools, ...item.tools];
			const counts: ActivityCounts = {explored: 0, searched: 0, fetched: 0, edited: 0};
			for (const t of combinedTools) {
				const kind = classifyToolActivity(t.tool);
				if (kind !== 'other') counts[kind] += 1;
			}
			const summary = formatActivitySummary(counts) || `Explored ${combinedTools.length}`;
			result[result.length - 1] = {
				kind: 'exploring',
				id: prev.id,
				summary,
				toolIds: [...prev.toolIds, ...item.toolIds],
				tools: combinedTools,
				open: prev.open || item.open
			};
		} else {
			result.push(item);
		}
	}
	return result;
}

/**
 * While the turn is still streaming, keep shimmer on the latest activity tip —
 * even after its tools have finished (e.g. "Explored 1 file, 2 searches").
 * Earlier process stacks collapse so only the tip signals live work.
 */
function pinLiveActivityTip(items: TimelineItem[], turnActive: boolean): TimelineItem[] {
	if (!turnActive || items.length === 0) return items;

	let tip = -1;
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i]!;
		if (
			item.kind === 'exploring' ||
			item.kind === 'thought' ||
			item.kind === 'processStack'
		) {
			tip = i;
			break;
		}
		if (
			(item.kind === 'tool' || item.kind === 'file') &&
			item.status === 'running'
		) {
			tip = i;
			break;
		}
		// Skip prose / chrome; keep scanning for the latest process tip.
		if (
			item.kind === 'assistant' ||
			item.kind === 'user' ||
			item.kind === 'system' ||
			item.kind === 'activity' ||
			item.kind === 'approval' ||
			item.kind === 'question' ||
			item.kind === 'plan' ||
			item.kind === 'tool' ||
			item.kind === 'file'
		) {
			continue;
		}
	}
	if (tip < 0) return items;

	return items.map((item, i) => {
		if (i === tip) {
			if (
				(item.kind === 'exploring' ||
					item.kind === 'thought' ||
					item.kind === 'processStack') &&
				!item.open
			) {
				return {...item, open: true};
			}
			return item;
		}
		// Only the tip should shimmer / default-expand while the turn is live.
		if (item.kind === 'processStack' && item.open) {
			return {...item, open: false};
		}
		return item;
	});
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

/**
 * Wrap consecutive sealed Thought / Exploring rows into Process Stack windows.
 * Streaming (open) rows and consequential cards break the run.
 */
export function wrapProcessStacks(
	items: TimelineItem[],
	options: {turnActive: boolean; entryId: string}
): TimelineItem[] {
	const merged = mergeAdjacentExploring(items);
	const out: TimelineItem[] = [];
	let buf: ProcessStackStep[] = [];
	let stackIndex = 0;

	const flush = () => {
		if (buf.length >= PROCESS_STACK_MIN_STEPS) {
			out.push({
				kind: 'processStack',
				id: `${options.entryId}-process-${stackIndex}`,
				steps: buf,
				stepCount: buf.length,
				open: options.turnActive
			});
			stackIndex += 1;
		} else {
			out.push(...buf);
		}
		buf = [];
	};

	for (const item of merged) {
		if (isSealedProcessStep(item)) {
			buf.push(item);
			continue;
		}
		flush();
		out.push(item);
	}
	flush();
	return absorbCancelledMarkers(pinLiveActivityTip(out, options.turnActive));
}

/**
 * Fold standalone `Cancelled` system rows into the preceding process stack tip
 * (same turn — stop at user). Always drop the system row so the dialog never
 * shows a lone Cancelled line.
 */
function absorbCancelledMarkers(items: TimelineItem[]): TimelineItem[] {
	const out: TimelineItem[] = [];
	for (const item of items) {
		if (item.kind === 'system' && item.tone === 'cancelled') {
			for (let i = out.length - 1; i >= 0; i--) {
				const prev = out[i]!;
				if (prev.kind === 'processStack') {
					out[i] = {...prev, cancelled: true};
					break;
				}
				if (prev.kind === 'user') break;
			}
			continue;
		}
		out.push(item);
	}
	return out;
}

/**
 * Project a single transcript entry.
 * Used by the turn-level projection cache so streaming the latest turn does not
 * rebuild historical turns.
 * `prevUser` is retained for call-site / cache API stability (unused after slash chrome moved to the user row).
 */
export function plansById(entries: TranscriptEntry[]): Map<string, PlanView> {
	const map = new Map<string, PlanView>();
	for (const entry of entries) {
		if (entry.role !== 'assistant') continue;
		for (const seg of entry.segments ?? []) {
			if (seg.kind === 'plan') map.set(seg.plan.planId, seg.plan);
		}
	}
	return map;
}

export function projectEntryToTimelineItems(
	entry: TranscriptEntry,
	_prevUser: TranscriptEntry | undefined,
	options: TimelineOptions & {planViews?: Map<string, PlanView>} = {}
): TimelineItem[] {
	const fileDiffs = options.fileDiffs ?? {};
	const diffLineBudget = options.diffLineBudget ?? 9;
	const items: TimelineItem[] = [];
	if (entry.role === 'user') {
		const text = extractQuery(entry.text);
		const trimmed = text.trimStart();
		const planId = entry.planId?.trim();
		const planBuild =
			entry.messageType === 'plan_build' && planId
				? {
						planBuild: {
							planId,
							name: entry.planName?.trim() || options.planViews?.get(planId)?.name || '',
							plan: options.planViews?.get(planId) ?? null
						}
					}
				: {};
		items.push({
			kind: 'user',
			id: entry.id,
			text,
			// `/skill args` live turns, or legacy `[Skill: name]…` on restore.
			isCommand: parseUserSkillDisplay(trimmed) != null,
			...(entry.turnId ? {runId: entry.turnId} : {}),
			...(entry.origin === 'scheduler_generated' ? {origin: entry.origin} : {}),
			...planBuild
		});
		return items;
	}
	if (entry.messageType === 'goal_step_conclusion') {
		items.push({
			kind: 'goalStepConclusion',
			id: entry.id,
			agentName: entry.goalAgentName?.trim() || entry.goalStepId?.trim() || 'step',
			...(entry.goalVerdict ? {verdict: entry.goalVerdict} : {}),
			...(entry.goalId ? {goalId: entry.goalId} : {}),
			...(entry.goalStepId ? {stepId: entry.goalStepId} : {}),
			text: entry.text,
			status: entry.status
		});
		return items;
	}
	if (entry.messageType === 'goal_outcome' && entry.goalId?.trim()) {
		items.push({
			kind: 'goalOutcome',
			id: entry.id,
			goalId: entry.goalId.trim(),
			goalStatus: entry.goalStatus?.trim() || 'finished',
			text: entry.text,
			status: entry.status
		});
		return items;
	}
	pushAssistantItems(items, entry, fileDiffs, diffLineBudget);
	return items;
}

/** IPC / cache snapshots may omit newer fields. */
export type TimelineSource = Pick<TranscriptState, 'entries' | 'approvals' | 'questions'> & {
	questionBatches?: TranscriptState['questionBatches'];
	subagents?: TranscriptState['subagents'];
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
		// D4: a superseded FAILED run keeps its error card visible (stale state
		// machine grays it once the retry terminal lands); only its answer rows hide.
		if (
			entry.role !== 'user' &&
			entry.turnId &&
			markers[entry.turnId] &&
			entry.status !== 'error'
		)
			continue;
		if (
			entry.role !== 'user' &&
			entry.turnId &&
			entry.status !== 'error' &&
			options.hiddenRuns?.has(entry.turnId)
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
