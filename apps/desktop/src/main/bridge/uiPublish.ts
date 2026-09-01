/**
 * Classify Bridge events for Thin Client UI publish (ADR-0005).
 * - none: keepalive
 * - content: body growth → narrow Transcript patch (coalesced)
 * - snapshot: structure / control → full Tasks snapshot
 */
export type UiPublishKind = 'none' | 'content' | 'snapshot';

const NONE = new Set([
	'Heartbeat',
	'Ack',
	'open_project_set',
	// Checkpoint push: the review drawer re-reads its own list from these, and neither carries
	// anything the Tasks/Projects chrome renders — a snapshot per agent write batch would be waste.
	'tree_advanced',
	'review_changed',
	// Editor FS watch — Document/Diff surfaces subscribe; chrome must not snapshot.
	'workspace_file_changed'
]);

/** Body-only updates that should not refresh the Tasks list chrome. */
const CONTENT = new Set([
	'assistant_delta',
	'reasoning_delta',
	'tool_output',
	'tool_started',
	'tool_finished',
	// Projected as entry content by session-view (tool rows inside the assistant
	// entry) — classifying them snapshot caused a full workspace publish per event.
	'file_read',
	'agent_call_started',
	'agent_call_finished',
	// Live process drawer updates are Transcript sections too. They can arrive at
	// token-like frequency and must never rebuild Projects/Tasks chrome.
	'proc_updated',
	'background_task_output',
	'background_task_completed',
	// Body-only drawer row update (LiveChildWork) — rides the tail-patch section.
	'child_work_changed'
]);

export function classifyBridgeEventForUi(eventType: string): UiPublishKind {
	if (NONE.has(eventType)) return 'none';
	if (CONTENT.has(eventType)) return 'content';
	return 'snapshot';
}

/**
 * 30ms coalesce：流式 token 到达后最多等 30ms 就 flush 到 renderer。
 * renderer 端 useStreamingText 做打字机插帧，所以 coalesce 大小不影响视觉平滑度——
 * 只需保证定期有 patch 让 latestRef 推进即可。tail patch 只传 diff，payload 极小。
 */
export const CONTENT_PATCH_COALESCE_MS = 30;

export type CoalescedPublisher = {
	schedule: () => void;
	flushNow: () => void;
	cancel: () => void;
	pending: () => boolean;
};

/** Coalesce rapid schedule() calls into one flush after windowMs. */
export function createCoalescedPublisher(
	windowMs: number,
	flush: () => void,
	setTimeoutFn: typeof setTimeout = setTimeout,
	clearTimeoutFn: typeof clearTimeout = clearTimeout
): CoalescedPublisher {
	let timer: ReturnType<typeof setTimeout> | null = null;

	return {
		schedule() {
			if (timer != null) return;
			timer = setTimeoutFn(() => {
				timer = null;
				flush();
			}, windowMs);
		},
		flushNow() {
			if (timer != null) {
				clearTimeoutFn(timer);
				timer = null;
			}
			flush();
		},
		cancel() {
			if (timer == null) return;
			clearTimeoutFn(timer);
			timer = null;
		},
		pending() {
			return timer != null;
		}
	};
}
