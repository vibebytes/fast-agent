import {extractQuery, parseUserSkillDisplay} from '@fastllm/bridge-protocol';
import type {ToolCallView, TranscriptEntry} from '../transcriptProjection.js';
import {
	classifyToolActivity,
	countDiffStats,
	formatActivitySummary,
	isWriteTool,
	parseDiffWithLineNumbers,
	type ActivityCounts
} from '../diff.js';
import type {PlanView} from '../plan.js';
import {COMPACTION_WAIT_REASON, fileOp, thoughtChromeFrom} from '../chrome.js';
import {normalizeToolOutput} from '../toolOutput.js';
import type {TimelineItem, TimelineOptions} from '../timeline.js';
import {
	formatToolArgs,
	isExploreLike,
	pathFromTool,
	resolveDiffText,
	toolCommand,
	toolTitle
} from './toolFormat.js';

export function pushAssistantItems(
	items: TimelineItem[],
	entry: TranscriptEntry,
	fileDiffs: Record<string, string | undefined>,
	diffLineBudget: number
): void {
	const tools = entry.tools ?? [];
	const toolById = new Map(tools.map(t => [t.id, t]));
	const engineRun = engineRunId(entry);
	const runId: {readonly runId: string} | Record<string, never> = engineRun
		? ({runId: engineRun} as const)
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

	if (entry.status === 'error') ensureErrorAssistant(items, entry, engineRunId(entry));

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

	// Compaction blocks the turn between tool rounds, when the entry already has segments /
	// text and no open thought — give the wait its own open row so it is visible anyway.
	if (
		entry.status === 'streaming' &&
		wait?.reason === COMPACTION_WAIT_REASON &&
		!items.some(i => i.kind === 'thought' && i.open)
	) {
		items.push({
			kind: 'thought',
			id: `${entry.id}-compacting`,
			text: '',
			chrome: thoughtChromeFrom('', {open: true, wait}),
			open: true
		});
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

/**
 * Engine run identity for retry / regenerate / supersedes matching. Live entries key
 * `turnId` by runId; restored entries key it by the user message id and carry the run
 * separately, so the wire `runId` wins when present.
 */
export function engineRunId(entry: TranscriptEntry): string | undefined {
	return entry.runId ?? entry.fault?.runId ?? entry.turnId;
}

/** Failed turns must end on an error-status assistant (ErrorCard), never a done reply. */
export function ensureErrorAssistant(items: TimelineItem[], entry: TranscriptEntry, turnId?: string): void {
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

export function pushFileItem(
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

export function pushToolItem(items: TimelineItem[], tool: ToolCallView): void {
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
			...(engineRunId(entry) ? {runId: engineRunId(entry)} : {}),
			...(entry.origin === 'scheduler_generated' ? {origin: entry.origin} : {}),
			...(entry.images?.length ? {images: entry.images} : {}),
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
