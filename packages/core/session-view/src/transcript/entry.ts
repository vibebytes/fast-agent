import {documentCard} from '../chatDocument.js';
import type {EntrySegment, ToolCallView, TranscriptEntry, TranscriptState} from './state.js';

export function clearWaitState(entry: TranscriptEntry): TranscriptEntry {
	if (!entry.waitState) return entry;
	const {waitState: _removed, ...rest} = entry;
	return rest;
}

/** Scope segment ids by entry so VirtualTranscript keys (`assistant-${id}`) stay unique across turns. */
export function nextSegmentId(entryId: string, segments: EntrySegment[], prefix: string): string {
	return `seg-${prefix}-${entryId}-${segments.length}`;
}

/** Close a superseded stream without calling it cancelled (no Stop / no engine abort). */
export function sealStreamingAsDone(entry: TranscriptEntry): TranscriptEntry {
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

export function sealOpenThinking(entry: TranscriptEntry, at: number = Date.now()): TranscriptEntry {
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

export function pushThinkingSegment(entry: TranscriptEntry, text: string): TranscriptEntry {
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

export function persistDelta(event: {eventSeq?: number}): boolean {
	return typeof event.eventSeq === 'number' && event.eventSeq > 0;
}

export function pushAssistantSegment(
	entry: TranscriptEntry,
	text: string,
	unitId?: string,
	persist = false
): TranscriptEntry {
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
	const live = entry.text;
	// Guard against engine re-emitting the full answer, and align persist/full
	// chrome against live prefix instead of appending a second copy (P1-3).
	if (live.length > 0 && text === live) {
		return {...entry, status: 'streaming'};
	}
	if (live.length > 0 && text.startsWith(live)) {
		return extendAssistantText(entry, text, unitId);
	}
	// Stale persist snapshot of the same document (live chrome already painted further).
	// Must not apply to live incremental tokens — repeating fragments like `0x` match
	// the document start and would otherwise be dropped instead of appended.
	if (persist && live.length > 0 && live.startsWith(text)) {
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

/** Replace live assistant prose with a longer persist/full snapshot of the same card. */
export function extendAssistantText(entry: TranscriptEntry, incoming: string, unitId?: string): TranscriptEntry {
	const sealed = sealOpenThinking(entry);
	const suffix = incoming.slice(entry.text.length);
	if (!suffix) return {...sealed, status: 'streaming'};
	const segments = sealed.segments ?? [];
	const last = segments.at(-1);
	const sameUnit =
		last?.kind === 'assistant' &&
		(unitId == null || last.unitId == null || last.unitId === unitId);
	if (sameUnit && last?.kind === 'assistant') {
		return {
			...sealed,
			text: incoming,
			status: 'streaming',
			segments: segments.map((segment, index) =>
				index === segments.length - 1 && segment.kind === 'assistant'
					? {...segment, text: segment.text + suffix, unitId: segment.unitId ?? unitId}
					: segment
			)
		};
	}
	return {
		...sealed,
		text: incoming,
		status: 'streaming',
		segments: [
			...segments,
			{kind: 'assistant', id: nextSegmentId(entry.id, segments, 'a'), text: suffix, unitId}
		]
	};
}

export function applyCheckpoint(entry: TranscriptEntry, unitId: string, content: string): TranscriptEntry {
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

export function markStreamIncomplete(state: TranscriptState): TranscriptState {
	let changed = false;
	const entries = state.entries.map(entry => {
		if (entry.role !== 'assistant' || entry.status !== 'streaming' || entry.streamIncomplete) return entry;
		changed = true;
		return {...entry, streamIncomplete: true};
	});
	return changed ? {...state, entries} : state;
}

export function pushToolSegment(entry: TranscriptEntry, tool: ToolCallView): TranscriptEntry {
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

export function patchAssistant(
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
