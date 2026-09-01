/**
 * Session View — production projection: Transcript (+ Code Changes + cancel) → TimelineItem[].
 * Thin Clients should call projectSessionView; low-level toTimelineItems / cache remain for tests.
 */
import type {TranscriptEntry, TranscriptState} from './transcriptProjection.js';
import {createTimelineProjectionCache, type TimelineProjectionCache} from './timelineCache.js';
import {wrapProcessStacks, type TimelineItem, type TimelineSource} from './timeline.js';
import {countDiffStats} from './diff.js';
import type {CodeChange} from './wire.js';

/** Code Changes as consumed by Session View (tool name optional for hosts that omit it). */
export type SessionViewCodeChange = Pick<CodeChange, 'id' | 'path' | 'status' | 'diff' | 'summary'> & {
	tool?: string;
};

export type ProjectSessionViewOptions = {
	/** From Composer Gate — which in-flight user row may show Stop. */
	canCancel: boolean;
	/** P1b rerun provenance (victim runId → superseding turn id); passed through to the timeline. */
	rerunMarkers?: Record<string, string>;
	/** D10 regenerate live channel — victim runIds hidden while the re-run streams. */
	hiddenRuns?: ReadonlySet<string>;
};

export type ReviewFile = {
	id: string;
	path: string;
	add: number;
	del: number;
	status?: SessionViewCodeChange['status'];
};

function fileDiffsFrom(codeChanges: SessionViewCodeChange[]): Record<string, string | undefined> {
	const fileDiffs: Record<string, string | undefined> = {};
	for (const change of codeChanges) {
		fileDiffs[change.id] = change.diff;
		fileDiffs[change.path] = change.diff;
	}
	return fileDiffs;
}

/**
 * User-prompt Stop is only for the in-flight Turn's prompt — not every past user bubble.
 */
export function activeUserEntryIdForStop(
	entries: Array<{
		id: string;
		role: 'user' | 'assistant';
		status: string;
		turnId?: string;
		clientMessageId?: string;
	}>
): string | null {
	if (!Array.isArray(entries)) return null;
	const assistant =
		entries.find(e => e.role === 'assistant' && e.status === 'streaming') ??
		[...entries].reverse().find(e => e.role === 'assistant' && e.status === 'cancelled');
	if (!assistant) return null;

	const idx = entries.indexOf(assistant);
	for (let i = idx - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.role !== 'user') continue;
		if (
			(assistant.turnId && entry.turnId === assistant.turnId) ||
			(assistant.clientMessageId &&
				(entry.turnId === assistant.clientMessageId ||
					entry.clientMessageId === assistant.clientMessageId))
		) {
			return entry.id;
		}
		return entry.id;
	}
	return null;
}

function withShowStop(items: TimelineItem[], stopUserEntryId: string | null): TimelineItem[] {
	if (!stopUserEntryId) return items;
	// PlanBuild users also get showStop — Build Dock reads it; bubble Stop is suppressed in UI.
	return items.map(item =>
		item.kind === 'user' && item.id === stopUserEntryId ? {...item, showStop: true} : item
	);
}

/**
 * Create a Session View projector with an internal timeline cache.
 * Prefer one instance per Transcript surface (e.g. one per App mount).
 */
export function createSessionViewProjector() {
	const projectCached: TimelineProjectionCache = createTimelineProjectionCache();
	// 刀 5a: the cache's frozen-head fast path compares the fileDiffs container by
	// reference — rebuild it only when codeChanges itself changed identity
	// (projection immutability: same array reference ⇒ same contents).
	let lastCodeChanges: SessionViewCodeChange[] | null = null;
	let lastFileDiffs: Record<string, string | undefined> = {};

	return function projectSessionView(
		state: TimelineSource,
		codeChanges: SessionViewCodeChange[],
		options: ProjectSessionViewOptions
	): TimelineItem[] {
		const entries = Array.isArray(state.entries) ? state.entries : [];
		if (codeChanges !== lastCodeChanges) {
			lastCodeChanges = codeChanges;
			lastFileDiffs = fileDiffsFrom(codeChanges);
		}
		const items = projectCached(
			{
				entries,
				approvals: state.approvals ?? [],
				questions: state.questions ?? [],
				questionBatches: state.questionBatches ?? [],
				subagents: state.subagents ?? []
			},
			{fileDiffs: lastFileDiffs, rerunMarkers: options.rerunMarkers, hiddenRuns: options.hiddenRuns}
		);
		// Process Stack is a global post-pass (same options as toTimelineItems so
		// cached projection stays deep-equal): per-entry wrapping cannot merge
		// sealed runs that span Turn boundaries.
		const last = entries[entries.length - 1];
		const wrapped = wrapProcessStacks(items, {
			turnActive: last?.status === 'streaming',
			entryId: last?.id ?? 'global'
		});
		const stopId = options.canCancel ? activeUserEntryIdForStop(entries) : null;
		return withShowStop(wrapped, stopId);
	};
}

/** One-shot projection (creates a fresh cache — fine for tests; hosts should reuse createSessionViewProjector). */
export function projectSessionView(
	state: TimelineSource,
	codeChanges: SessionViewCodeChange[],
	options: ProjectSessionViewOptions
): TimelineItem[] {
	return createSessionViewProjector()(state, codeChanges, options);
}

/** Composer Review strip — sibling of Session View, not part of projectSessionView's return. */
export function reviewFiles(
	timeline: TimelineItem[],
	codeChanges: SessionViewCodeChange[]
): ReviewFile[] {
	const byPath = new Map<string, ReviewFile>();

	for (const item of timeline) {
		if (item.kind !== 'file') continue;
		byPath.set(item.path, {
			id: item.id,
			path: item.path,
			add: item.add,
			del: item.del,
			status: item.status === 'running' ? 'running' : item.status === 'error' ? 'error' : 'done'
		});
	}

	for (const change of codeChanges) {
		const existing = byPath.get(change.path);
		const {add, del} = countDiffStats(change.diff);
		if (!existing) {
			byPath.set(change.path, {
				id: change.id,
				path: change.path,
				add,
				del,
				status: change.status
			});
			continue;
		}
		if (existing.add === 0 && existing.del === 0 && (add > 0 || del > 0)) {
			byPath.set(change.path, {
				...existing,
				id: change.id,
				add,
				del,
				status: change.status
			});
		}
	}

	return [...byPath.values()];
}
