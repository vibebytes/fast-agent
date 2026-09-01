import type {
	ThinkingDisplayMode,
	Turn,
	TurnSegment,
	ToolRun,
	UiState,
	Approval,
	UserQuestion
} from '../model.js';
import {approvalsFromState, questionsFromState} from '../model.js';
import type {TimelineItem, TimelineState} from './model.js';
import {splitStableChunks} from '../../utils/safeSplit.js';
import {agentCallItems} from './agentTree.js';
import {extractQuery} from '@fastllm/bridge-protocol';
import type {EntrySegment, ToolCallView, TranscriptEntry} from '@fast-ide/session-view';
import {networkWaitLabel} from '@fast-ide/session-view';

function waitLabelFromEntry(entry: TranscriptEntry): string | undefined {
	return networkWaitLabel(entry.waitState);
}

/**
 * Convert transcript.entries + localTurns + pending prompts into TimelineItem[]
 * with correct settled/pending semantics for Ink's <Static> region.
 *
 * THE invariant of this module: across consecutive UI states produced by the
 * reducer, the sequence of settled items (`pending !== true`) is append-only —
 * previously settled items keep their id, position and rendered appearance.
 * <Static> prints each settled item exactly once into terminal scrollback;
 * any violation corrupts the transcript (the historical root cause of the
 * torn/duplicated history bug). MainContent enforces this with a runtime
 * prefix guard that triggers a full repaint if the invariant ever breaks.
 *
 * Bridge content is projected from `@fast-ide/session-view` TranscriptState;
 * slash-command / notice cards come from `localTurns`.
 *
 * Settling rules:
 * - Optimistic user/assistant pairs (turnId === clientMessageId, not yet
 *   remapped by input_accepted) stay pending — their ids can still change
 *   via turnId remap while entry `id` stays stable.
 * - Within an accepted streaming assistant, every segment except the last is
 *   settled (applyBridgeEvent only appends to the last segment).
 * - The streaming last assistant segment is split at markdown-safe points
 *   (blank lines outside code fences): closed chunks settle immediately,
 *   only the open tail keeps re-rendering (gemini-cli's anti-flicker core).
 * - Tool segments settle only when every tool reached a terminal status.
 * - Approvals, questions and errors are always pending
 *   (they render live near the composer, never enter scrollback history).
 * - Items after a still-active entry/turn must not settle yet (slash command
 *   while a Bridge turn is streaming).
 */
export function turnsToTimeline(state: UiState): TimelineState {
	const entries = state.transcript.entries;
	const firstActiveEntry = entries.findIndex(isActiveEntry);
	const firstActiveLocal = state.localTurns.findIndex(isActiveLocalTurn);

	type Block = {seq: number; order: number; items: TimelineItem[]};
	const blocks: Block[] = [];
	let order = 0;

	for (const [index, entry] of entries.entries()) {
		if (
			state.rerunPendingRunId &&
			entry.role === 'assistant' &&
			entry.turnId === state.rerunPendingRunId &&
			entry.status !== 'error'
		) {
			continue;
		}
		const afterActive = firstActiveEntry >= 0 && index > firstActiveEntry;
		const entryItems = entryToTimelineItems(entry, state.thinkingDisplay, state.toolsExpanded);
		blocks.push({
			seq: state.entryStreamSeq[entry.id] ?? Number.MAX_SAFE_INTEGER - entries.length + index,
			order: order++,
			items: afterActive ? entryItems.map(item => ({...item, pending: true as const})) : entryItems
		});
	}

	// Merge local slash/command cards by streamSeq so /skills is not stuck under
	// later Bridge turns (entries-then-localTurns used to pin them at the bottom).
	for (const [index, turn] of state.localTurns.entries()) {
		const afterActive = firstActiveLocal >= 0 && index > firstActiveLocal;
		const turnItems = localTurnToTimelineItems(turn, state.thinkingDisplay);
		blocks.push({
			seq: turn.streamSeq ?? Number.MAX_SAFE_INTEGER - state.localTurns.length + index,
			order: order++,
			items: afterActive ? turnItems.map(item => ({...item, pending: true as const})) : turnItems
		});
	}

	blocks.sort((a, b) => a.seq - b.seq || a.order - b.order);
	const items: TimelineItem[] = blocks.flatMap(block => block.items);

	items.push(...agentCallItems(state.agentRuns));

	for (const approval of approvalsFromState(state)) {
		items.push({
			id: `approval-${approval.id}`,
			kind: 'approval_message',
			approval,
			runId: approval.runId,
			turnId: approval.turnId,
			pending: true
		});
	}

	for (const question of questionsFromState(state)) {
		items.push({
			id: `question-${question.id}`,
			kind: 'question_message',
			question,
			runId: question.runId ?? question.taskId,
			turnId: question.turnId,
			pending: true
		});
	}

	const visibleErrors = state.errors.slice(-3);
	const errorBase = state.errors.length - visibleErrors.length;
	for (const [index, error] of visibleErrors.entries()) {
		items.push({
			id: `error-${errorBase + index}`,
			kind: 'error_message',
			text: error,
			pending: true
		});
	}

	const activeTurnId =
		entries.find(e => e.role === 'assistant' && e.status === 'streaming')?.turnId
		?? state.localTurns.find(t => t.status === 'running' || t.status === 'pending')?.id
		?? entries.at(-1)?.turnId
		?? state.localTurns.at(-1)?.id;

	return {items: sealAfterFirstPending(items), activeTurnId};
}

/**
 * Enforce the append-only invariant STRUCTURALLY: the settled items must be a
 * prefix of the timeline — everything after the first pending item stays
 * pending. Without this, an item that settles behind a still-pending one
 * (e.g. an assistant chunk streamed while an earlier tool is still running)
 * would later be joined by that tool settling BEFORE it — a mid-sequence
 * insertion that corrupts <Static> scrollback and forces a drift repaint.
 */
function sealAfterFirstPending(items: TimelineItem[]): TimelineItem[] {
	const firstPending = items.findIndex(item => item.pending === true);
	if (firstPending < 0) return items;
	return items.map((item, index) =>
		index > firstPending && item.pending !== true ? {...item, pending: true} : item
	);
}

function isActiveEntry(entry: TranscriptEntry): boolean {
	if (entry.role === 'user') {
		// Optimistic user row: not yet remapped by input_accepted.
		return Boolean(entry.clientMessageId && entry.turnId === entry.clientMessageId);
	}
	return entry.status === 'streaming'
		|| Boolean(entry.clientMessageId && entry.turnId === entry.clientMessageId);
}

function isActiveLocalTurn(turn: Turn): boolean {
	return turn.status === 'running' || turn.status === 'pending' || turn.status === 'clarify';
}

function entryToTimelineItems(
	entry: TranscriptEntry,
	mode: ThinkingDisplayMode,
	toolsExpanded: boolean
): TimelineItem[] {
	if (entry.role === 'user') {
		const pending = Boolean(entry.clientMessageId && entry.turnId === entry.clientMessageId);
		return [{
			id: entry.id,
			kind: 'user_message',
			turnId: entry.turnId ?? entry.id,
			text: extractQuery(entry.text),
			pending: pending || undefined
		}];
	}

	const active = entry.status === 'streaming';
	const allPending = Boolean(entry.clientMessageId && entry.turnId === entry.clientMessageId);
	const turnId = entry.turnId ?? entry.id;
	const items: TimelineItem[] = [];
	const segments = entry.segments ?? [];

	if (segments.length > 0) {
		items.push(...entrySegmentItems(entry, mode, allPending, toolsExpanded));
	} else {
		items.push(...legacyEntryItems(entry, mode, allPending, toolsExpanded));
	}

	const runningIndicatorCovered = segments.length === 0
		|| segments.at(-1)?.kind === 'thinking';
	if (active && !runningIndicatorCovered) {
		items.push({
			id: `${entry.id}-running`,
			kind: 'thinking_message',
			turnId,
			text: '',
			running: true,
			hideBody: true,
			pending: true,
			waitLabel: waitLabelFromEntry(entry)
		});
	}

	return items;
}

function entrySegmentItems(
	entry: TranscriptEntry,
	mode: ThinkingDisplayMode,
	allPending: boolean,
	toolsExpanded: boolean
): TimelineItem[] {
	const items: TimelineItem[] = [];
	const active = entry.status === 'streaming';
	const turnId = entry.turnId ?? entry.id;
	const segments = entry.segments ?? [];
	const lastSegment = segments.at(-1);
	// Map lookup — per-segment .find() over the tool list was O(n²) for
	// tool-heavy turns (50+ calls per turn on coding agents).
	const toolById = new Map((entry.tools ?? []).map(t => [t.id, mapTool(t, toolsExpanded)]));

	for (const segment of segments) {
		const isLast = segment === lastSegment;
		const segmentClosed = !isLast || !active;
		const pendingFlag = (value: boolean) => (allPending || value ? true : undefined);

		switch (segment.kind) {
			case 'thinking': {
				const running = active && isLast;
				const item = buildThinkingItem(
					turnId, entry.id, mode, segment.id, segment.text, running, toolsExpanded,
					running ? waitLabelFromEntry(entry) : undefined
				);
				if (item) {
					items.push({...item, pending: pendingFlag(!segmentClosed)});
				}
				break;
			}
			case 'assistant': {
				if (segment.text.length === 0) break;
				const streaming = active && isLast;
				const {chunks, tail} = splitStableChunks(segment.text);
				for (const [index, chunk] of chunks.entries()) {
					items.push({
						id: `${entry.id}-${segment.id}-c${index}`,
						kind: 'assistant_message',
						turnId,
						text: chunk,
						streaming: false,
						continuation: index > 0,
						pending: allPending || undefined
					});
				}
				if (tail.trim().length > 0 || chunks.length === 0) {
					items.push({
						id: `${entry.id}-${segment.id}-tail`,
						kind: 'assistant_message',
						turnId,
						text: tail,
						streaming,
						continuation: chunks.length > 0,
						pending: pendingFlag(!segmentClosed)
					});
				}
				break;
			}
			case 'tools': {
				const groupTools = segment.toolIds
					.map(id => toolById.get(id))
					.filter((tool): tool is ToolRun => Boolean(tool));
				if (groupTools.length === 0) break;
				const anyRunning = groupTools.some(tool => tool.status === 'running');
				items.push({
					id: `${entry.id}-${segment.id}`,
					kind: 'tool_group',
					turnId,
					tools: groupTools,
					expanded: toolsExpanded,
					pending: pendingFlag(!segmentClosed || anyRunning)
				});
				break;
			}
		}
	}

	return items;
}

function legacyEntryItems(
	entry: TranscriptEntry,
	mode: ThinkingDisplayMode,
	allPending: boolean,
	toolsExpanded: boolean
): TimelineItem[] {
	const items: TimelineItem[] = [];
	const active = entry.status === 'streaming';
	const turnId = entry.turnId ?? entry.id;
	const running = active;
	const pending = allPending || active ? true : undefined;
	const reasoning = entry.reasoning ?? '';

	if (reasoning.length > 0 || running) {
		const item = buildThinkingItem(
			turnId, entry.id, mode, 'thinking', reasoning, running, toolsExpanded,
			running ? waitLabelFromEntry(entry) : undefined
		);
		if (item) items.push({...item, pending});
	}

	const tools = (entry.tools ?? []).map(t => mapTool(t, toolsExpanded));
	if (tools.length > 0) {
		items.push({
			id: `${entry.id}-tools`,
			kind: 'tool_group',
			turnId,
			tools,
			expanded: toolsExpanded,
			pending
		});
	}

	if (entry.text.length > 0) {
		items.push({
			id: `${entry.id}-assistant`,
			kind: 'assistant_message',
			turnId,
			text: entry.text,
			streaming: running,
			pending
		});
	}

	return items;
}

function mapTool(tool: ToolCallView, expanded: boolean): ToolRun {
	const status: ToolRun['status'] =
		tool.status === 'error' ? 'failed'
			: tool.status === 'cancelled' ? 'denied'
				: tool.status;
	const outputText = tool.output ?? '';
	return {
		id: tool.id,
		tool: tool.tool,
		args: tool.args ?? {},
		output: outputText.length > 0 ? [{stream: 'stdout', text: outputText}] : [],
		status,
		fields: tool.fields ?? {},
		startedAt: tool.startedAt,
		expanded
	};
}

function buildThinkingItem(
	turnId: string,
	entryId: string,
	mode: ThinkingDisplayMode,
	segId: string,
	text: string,
	running: boolean,
	toolsExpanded: boolean,
	waitLabel?: string
): TimelineItem | null {
	if (mode === 'off') {
		if (!running) return null;
		return {
			id: `${entryId}-${segId}`,
			kind: 'thinking_message',
			turnId,
			text: '',
			running: true,
			hideBody: true,
			waitLabel
		};
	}
	if (!running && text.trim().length === 0) return null;
	const collapsed = mode === 'compact' && !running && !toolsExpanded;
	return {
		id: `${entryId}-${segId}`,
		kind: 'thinking_message',
		turnId,
		text,
		running,
		collapsed,
		waitLabel: running ? waitLabel : undefined
	};
}

function localTurnToTimelineItems(turn: Turn, mode: ThinkingDisplayMode): TimelineItem[] {
	const active = isActiveLocalTurn(turn);
	const allPending = turn.status === 'pending';
	const items: TimelineItem[] = [];

	if (turn.userText.length > 0) {
		items.push({
			id: `${turn.id}-user`,
			kind: 'user_message',
			turnId: turn.id,
			text: turn.userText,
			pending: allPending || undefined
		});
	}

	if (turn.segments.length > 0) {
		items.push(...localSegmentItems(turn, mode, allPending));
	}

	const runningIndicatorCovered = turn.segments.length === 0
		|| turn.segments.at(-1)?.kind === 'thinking';
	if (active && turn.status === 'running' && !runningIndicatorCovered) {
		items.push({
			id: `${turn.id}-running`,
			kind: 'thinking_message',
			turnId: turn.id,
			text: '',
			running: true,
			hideBody: true,
			pending: true
		});
	}

	return items;
}

function localSegmentItems(turn: Turn, mode: ThinkingDisplayMode, allPending: boolean): TimelineItem[] {
	const items: TimelineItem[] = [];
	const active = isActiveLocalTurn(turn);
	const lastSegment = turn.segments.at(-1);
	const localToolById = new Map(turn.tools.map(tool => [tool.id, tool]));

	for (const segment of turn.segments) {
		const isLast = segment === lastSegment;
		const segmentClosed = !isLast || !active;
		const pendingFlag = (value: boolean) => (allPending || value ? true : undefined);

		switch (segment.kind) {
			case 'thinking': {
				const running = active && turn.status === 'running' && isLast;
				const item = buildThinkingItem(turn.id, turn.id, mode, segment.id, segment.text, running, turn.toolsExpanded === true);
				if (item) {
					items.push({...item, pending: pendingFlag(!segmentClosed)});
				}
				break;
			}
			case 'assistant': {
				if (segment.text.length === 0) break;
				const streaming = active && turn.status === 'running' && isLast;
				const {chunks, tail} = splitStableChunks(segment.text);
				for (const [index, chunk] of chunks.entries()) {
					items.push({
						id: `${turn.id}-${segment.id}-c${index}`,
						kind: 'assistant_message',
						turnId: turn.id,
						text: chunk,
						streaming: false,
						continuation: index > 0,
						pending: allPending || undefined
					});
				}
				if (tail.trim().length > 0 || chunks.length === 0) {
					items.push({
						id: `${turn.id}-${segment.id}-tail`,
						kind: 'assistant_message',
						turnId: turn.id,
						text: tail,
						streaming,
						continuation: chunks.length > 0,
						pending: pendingFlag(!segmentClosed)
					});
				}
				break;
			}
			case 'tools': {
				const tools = segment.toolIds
					.map(id => localToolById.get(id))
					.filter((tool): tool is NonNullable<ReturnType<typeof localToolById.get>> => Boolean(tool));
				if (tools.length === 0) break;
				const anyRunning = tools.some(tool => tool.status === 'running');
				items.push({
					id: `${turn.id}-${segment.id}`,
					kind: 'tool_group',
					turnId: turn.id,
					tools,
					expanded: turn.toolsExpanded === true,
					pending: pendingFlag(!segmentClosed || anyRunning)
				});
				break;
			}
			case 'system': {
				const msg = turn.systemMessages.find(message => message.id === segment.messageId);
				if (msg) {
					const isMenu =
						msg.kind === 'command_result'
						&& msg.text.split(/\r?\n/).filter(line => line.trim().length > 0).length > 1;
					// Keep expanded menus pending so the next submit can collapse them
					// without violating <Static> append-only appearance.
					const menuOpen = isMenu && msg.collapsed !== true;
					items.push({
						id: msg.id,
						kind: 'system_message',
						turnId: turn.id,
						text: msg.text,
						detail: msg.detail,
						variant: msg.kind,
						commandName: msg.commandName,
						commandStatus: msg.commandStatus,
						capability: msg.capability,
						availability: msg.availability,
						collapsed: msg.collapsed === true,
						pending: pendingFlag(menuOpen)
					});
				}
				break;
			}
		}
	}

	return items;
}

/** Split a timeline into the settled (scrollback) and live (re-rendered) parts. */
export function splitTimeline(timeline: TimelineState): {
	staticHistory: TimelineItem[];
	pendingItems: TimelineItem[];
} {
	const pendingItems = timeline.items.filter(item => item.pending === true);
	const staticHistory = timeline.items.filter(item => item.pending !== true);
	return {staticHistory, pendingItems};
}

export type {Approval, UserQuestion, TurnSegment, EntrySegment};
