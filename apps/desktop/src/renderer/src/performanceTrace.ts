/**
 * Tab-focus / Transcript switch tracing.
 *
 * Default OFF. Enable with `localStorage.setItem('fastIde.trace', '1')` and
 * reload; filter DevTools console by `[fast-ide trace]`.
 *
 * Span lifecycle for one Open Tab activation:
 *   tab.focus start → tab.ipc → tab.render* → tab.staging* → tab.focus end (+ tab.events dump)
 * End waits until IPC returns AND the interactive tail settles (body present,
 * deferred released, staging backfill/complete), so durationMs ≈ perceived
 * switch cost. Marks are no-ops while disabled.
 */

export type TabFocusUiNote = {
	taskId: string | null;
	bodyMissing?: boolean;
	/** True while useDeferredValue has not released the focused Task body. */
	deferredPending?: boolean;
	transcriptEntries?: number;
	timelineItems?: number;
	/** Session-view projector wall time for this render (ms). */
	projectMs?: number;
	/** Flow section count after stableTranscriptSections. */
	sections?: number;
	stagingPhase?: 'waiting' | 'staging' | 'complete' | string;
	stagingVisible?: number;
	/** Visible section count while staging (newest-first window). */
	stagingTotal?: number;
};

type TabFocusSpan = {
	id: string;
	taskId: string;
	fromTaskId: string | null;
	t0: number;
	ipcDone: boolean;
	ok: boolean;
	focusEpoch?: number;
	ipcMs?: number;
	ui: TabFocusUiNote & {renders: number; paints: number};
	ended: boolean;
	timer: ReturnType<typeof setTimeout> | null;
	/** Buffered events, dumped once at span end — live console.debug per mark
	 * costs 1-3ms each with DevTools open and polluted the measurement. */
	events: Array<Record<string, unknown>>;
};

const EVENT_BUFFER_MAX = 300;

const SETTLE_TIMEOUT_MS = 12_000;
const PREFIX = '[fast-ide trace]';

let active: TabFocusSpan | null = null;
let seq = 0;
/** FlowSection renders during the open span — attributes commit cost to rows. */
let rowRenders = 0;

function tracingOn(): boolean {
	try {
		if (typeof localStorage === 'undefined') return false;
		return localStorage.getItem('fastIde.trace') === '1';
	} catch {
		return false;
	}
}

function nowMs(): number {
	return typeof performance !== 'undefined' && typeof performance.now === 'function'
		? performance.now()
		: Date.now();
}

function spanId(): string {
	seq = (seq + 1) % 1_000_000;
	const rand = Math.random().toString(36).slice(2, 7);
	return `${seq}-${rand}`;
}

function log(event: string, detail: Record<string, unknown>): void {
	if (!tracingOn()) return;
	try {
		// Start/end print live; everything else buffers into the span and dumps
		// once at end, so the tracer does not distort what it measures.
		const span = active;
		if (span && !span.ended && !event.startsWith('tab.focus')) {
			if (span.events.length < EVENT_BUFFER_MAX) {
				span.events.push({
					event,
					atMs: Number((nowMs() - span.t0).toFixed(1)),
					...detail
				});
			}
			return;
		}
		console.debug(`${PREFIX} ${event}`, detail);
	} catch {
		/* DevTools closed / console poisoned — never break focus. */
	}
}

function clearTimer(span: TabFocusSpan): void {
	if (span.timer == null) return;
	clearTimeout(span.timer);
	span.timer = null;
}

function settleReady(span: TabFocusSpan): boolean {
	if (!span.ipcDone) return false;
	// Wait for a post-commit paint so VirtualTranscript can report staging first
	// (SessionPane samples before children render in the same pass).
	if (span.ui.paints < 1) return false;
	if (span.ui.renders < 1) return false;
	if (span.ui.taskId !== span.taskId) return false;
	if (span.ui.bodyMissing) return false;
	if (span.ui.deferredPending) return false;
	// Interactive settle: the tail window is mounted once phase reaches
	// 'backfill' (older sections keep mounting on idle) or 'complete'.
	// Undefined means VT has not reported yet.
	const phase = span.ui.stagingPhase;
	if (phase !== 'complete' && phase !== 'backfill') return false;
	return true;
}

function finish(span: TabFocusSpan, reason: string): void {
	if (span.ended) return;
	span.ended = true;
	clearTimer(span);
	if (active === span) {
		active = null;
		stopLoaf();
	}
	log('tab.focus end', {
		id: span.id,
		durationMs: Number((nowMs() - span.t0).toFixed(1)),
		taskId: span.taskId,
		ok: span.ok,
		focusEpoch: span.focusEpoch,
		reason,
		ipcMs: span.ipcMs,
		rowRenders,
		renders: span.ui.renders,
		paints: span.ui.paints,
		transcriptEntries: span.ui.transcriptEntries,
		timelineItems: span.ui.timelineItems,
		sections: span.ui.sections,
		projectMs: span.ui.projectMs,
		stagingPhase: span.ui.stagingPhase,
		bodyMissing: span.ui.bodyMissing,
		deferredPending: span.ui.deferredPending
	});
	if (span.events.length > 0 && tracingOn()) {
		try {
			console.debug(`${PREFIX} tab.events ${span.id}`, span.events);
		} catch {
			/* never break focus */
		}
	}
}

function maybeSettle(span: TabFocusSpan): void {
	if (span.ended) return;
	if (!settleReady(span)) return;
	finish(span, 'settled');
}

/** Active span for this Task, if any (used to skip hot-path marks). */
export function activeTabFocusTaskId(): string | null {
	return active && !active.ended ? active.taskId : null;
}

/** Start a tab.focus span. Supersedes any in-flight span. */
export function startTabFocus(args: {
	taskId: string;
	fromTaskId: string | null;
}): string {
	if (active && !active.ended) {
		finish(active, 'superseded');
	}
	rowRenders = 0;
	if (tracingOn()) startLoaf();
	const id = spanId();
	const span: TabFocusSpan = {
		id,
		taskId: args.taskId,
		fromTaskId: args.fromTaskId,
		t0: nowMs(),
		ipcDone: false,
		ok: true,
		ui: {taskId: null, renders: 0, paints: 0},
		ended: false,
		timer: null,
		events: []
	};
	active = span;
	span.timer = setTimeout(() => {
		if (active === span && !span.ended) finish(span, 'timeout');
	}, SETTLE_TIMEOUT_MS);
	log('tab.focus start', {
		id,
		taskId: args.taskId,
		fromTaskId: args.fromTaskId
	});
	return id;
}

/** Cold `task:list` body pull while focused (slim focus cache miss). */
export function markTabBodyPull(args: {
	taskId: string;
	phase: 'start' | 'end';
	durationMs?: number;
	ok?: boolean;
}): void {
	const span = active;
	if (!span || span.ended) return;
	if (args.taskId !== span.taskId) return;
	log('tab.bodyPull', {
		id: span.id,
		taskId: span.taskId,
		phase: args.phase,
		durationMs: args.durationMs,
		ok: args.ok,
		elapsedMs: Number((nowMs() - span.t0).toFixed(1))
	});
}

/** Mark `task:select` IPC completion (main-process focus publish). */
export function markTabFocusIpc(args: {
	id?: string;
	ok: boolean;
	focusEpoch?: number;
	durationMs: number;
	/** Wall time measured inside the Electron main handler (if returned). */
	main?: {
		mainMs: number;
		selectMs: number;
		publishMs: number;
		focusPayloadBytes: number;
	};
}): void {
	const span = active;
	if (!span || span.ended) return;
	if (args.id && args.id !== span.id) return;
	span.ipcDone = true;
	span.ok = args.ok;
	span.focusEpoch = args.focusEpoch;
	span.ipcMs = Number(args.durationMs.toFixed(1));
	const queueMs =
		args.main && args.main.mainMs >= 0
			? Number((span.ipcMs - args.main.mainMs).toFixed(1))
			: undefined;
	log('tab.ipc', {
		id: span.id,
		taskId: span.taskId,
		ok: args.ok,
		focusEpoch: args.focusEpoch,
		/** Renderer-awaited invoke latency (includes main + IPC queue + renderer congestion). */
		durationMs: span.ipcMs,
		/** Pure main-handler wall time. */
		mainMs: args.main?.mainMs,
		selectMs: args.main?.selectMs,
		publishMs: args.main?.publishMs,
		focusPayloadBytes: args.main?.focusPayloadBytes,
		/**
		 * durationMs − mainMs. Large positive ⇒ renderer/main event-loop congestion
		 * (or IPC scheduling), not slow select/publish logic.
		 */
		queueMs
	});
	if (!args.ok) {
		finish(span, 'ipc-failed');
		return;
	}
	maybeSettle(span);
}

/**
 * SessionPane render sample. Cheap; only logs while a matching span is open.
 * `atMs` is performance.now() so gaps between samples show layout/deferred lag.
 */
export function markTabRender(args: TabFocusUiNote & {atMs?: number}): void {
	const span = active;
	if (!span || span.ended) return;
	if (args.taskId && args.taskId !== span.taskId) return;
	span.ui = {
		...span.ui,
		...args,
		renders: span.ui.renders + 1,
		paints: span.ui.paints
	};
	log('tab.render', {
		atMs: Number((args.atMs ?? nowMs()).toFixed(1)),
		taskId: span.taskId,
		bodyMissing: Boolean(args.bodyMissing),
		deferredPending: Boolean(args.deferredPending),
		transcriptEntries: args.transcriptEntries,
		timelineItems: args.timelineItems,
		projectMs: args.projectMs,
		sections: args.sections,
		stagingPhase: args.stagingPhase,
		render: span.ui.renders
	});
	maybeSettle(span);
}

/** VirtualTranscript staging / section window progress. */
export function markTabStaging(args: {
	taskId: string | null;
	phase: string;
	visible: number;
	total: number;
	sections: number;
}): void {
	const span = active;
	if (!span || span.ended) return;
	if (args.taskId && args.taskId !== span.taskId) return;
	const changed =
		span.ui.stagingPhase !== args.phase ||
		span.ui.stagingVisible !== args.visible ||
		span.ui.stagingTotal !== args.total ||
		span.ui.sections !== args.sections;
	span.ui.stagingPhase = args.phase;
	span.ui.stagingVisible = args.visible;
	span.ui.stagingTotal = args.total;
	span.ui.sections = args.sections;
	span.ui.taskId = args.taskId;
	if (changed) {
		log('tab.staging', {
			id: span.id,
			taskId: span.taskId,
			phase: args.phase,
			visible: args.visible,
			total: args.total,
			sections: args.sections,
			elapsedMs: Number((nowMs() - span.t0).toFixed(1))
		});
	}
	maybeSettle(span);
}

/** Count one FlowSection render while a span is open (row-cost attribution). */
export function bumpTabRowRender(): void {
	if (active && !active.ended) rowRenders += 1;
}

/**
 * Long Animation Frame attribution while a span is open: splits each long
 * frame into script vs style/layout and names the top script invokers —
 * catches cost outside the React Profiler boundaries (sidebar, layout, GC).
 */
let loafObserver: PerformanceObserver | null = null;

function startLoaf(): void {
	try {
		loafObserver?.disconnect();
		loafObserver = new PerformanceObserver(entries => {
			const span = active;
			if (!span || span.ended) return;
			for (const raw of entries.getEntries()) {
				const e = raw as unknown as Record<string, number> & {
					scripts?: Array<Record<string, unknown>>;
				};
				const end = e.startTime + e.duration;
				log('tab.loaf', {
					id: span.id,
					durMs: Number(e.duration.toFixed(1)),
					styleLayoutMs:
						typeof e.styleAndLayoutStart === 'number' && e.styleAndLayoutStart > 0
							? Number((end - e.styleAndLayoutStart).toFixed(1))
							: undefined,
					scripts: (e.scripts ?? []).slice(0, 5).map(s => ({
						invoker: s.invoker,
						durMs: Number((s.duration as number).toFixed(1)),
						src: String(s.sourceURL ?? '').split('/').pop() || undefined
					})),
					elapsedMs: Number((nowMs() - span.t0).toFixed(1))
				});
			}
		});
		loafObserver.observe({type: 'long-animation-frame', buffered: false});
	} catch {
		loafObserver = null; // Older Chromium — attribution silently unavailable.
	}
}

function stopLoaf(): void {
	loafObserver?.disconnect();
	loafObserver = null;
}

/** React Profiler commit sample — attributes commit cost to a named subtree. */
export function markTabProfile(args: {
	subtree: string;
	phase: string;
	actualMs: number;
}): void {
	const span = active;
	if (!span || span.ended) return;
	// Sub-millisecond commits are noise (bailed-out subtrees).
	if (args.actualMs < 1) return;
	log('tab.profile', {
		id: span.id,
		subtree: args.subtree,
		phase: args.phase,
		actualMs: Number(args.actualMs.toFixed(1)),
		rowRenders,
		elapsedMs: Number((nowMs() - span.t0).toFixed(1))
	});
}

/** Post-paint sample (double rAF) — catches layout after React commit. */
export function markTabPaint(args: {taskId: string | null}): void {
	const span = active;
	if (!span || span.ended) return;
	if (args.taskId && args.taskId !== span.taskId) return;
	span.ui.paints += 1;
	log('tab.paint', {
		id: span.id,
		taskId: span.taskId,
		paint: span.ui.paints,
		elapsedMs: Number((nowMs() - span.t0).toFixed(1)),
		stagingPhase: span.ui.stagingPhase,
		deferredPending: span.ui.deferredPending,
		bodyMissing: span.ui.bodyMissing
	});
	maybeSettle(span);
}

/** Force-end (errors / unmount). Prefer natural settle. */
export function endTabFocus(args?: {ok?: boolean; reason?: string}): void {
	const span = active;
	if (!span || span.ended) return;
	if (args?.ok !== undefined) span.ok = args.ok;
	finish(span, args?.reason ?? 'forced');
}
