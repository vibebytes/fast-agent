import {
	memo,
	startTransition,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
	type RefObject
} from 'react';
import {useVirtualizer} from '@tanstack/react-virtual';
import {Button} from '@fast-ide/ui/components/button';
import {cn} from '@fast-ide/ui/lib/utils';
import {ArrowDown} from 'lucide-react';
import type {TimelineItem} from '@fast-ide/session-view';
import {BuildDock} from './session/BuildDock';
import {
	NEAR_BOTTOM_PX,
	NEAR_TOP_PX,
	FLOW_ONLY_MAX,
	estimateTimelineRowPx,
	flowContentVisibilityStyle,
	followWritePlan,
	isAutoScroll,
	isNearBottom,
	isNearTop,
	isNestedWheelArtifact,
	nestedScrollableConsumesWheel,
	prependWritePlan,
	remainingScrollPx,
	shrinkWritePlan,
	shouldIgnoreScrollProximity,
	stableTranscriptSections,
	transcriptFlowSplitAt,
	wheelIntent,
	type AutoScrollMark,
	type ViewportMetrics,
	type SectionsSnapshot,
	type TranscriptSection
} from './transcriptScroll';
import {
	TRANSCRIPT_BACKFILL_BATCH_SECTIONS,
	TRANSCRIPT_REVEAL_PAGE_SECTIONS,
	advanceTranscriptStaging,
	reconcileTranscriptStaging,
	visibleTranscriptSections,
	type TranscriptStagingState
} from './transcriptStaging';
import {activeTabFocusTaskId, bumpTabRowRender, markTabStaging} from './performanceTrace';

export type VirtualTranscriptProps = {
	items: TimelineItem[];
	/** Empty / error / greeting chrome above the virtualized rows. */
	header?: ReactNode;
	renderItem: (item: TimelineItem) => ReactNode;
	/** Changes when streaming content grows — used to follow bottom. */
	scrollKey: string;
	activeTaskId: string | null;
	/** Slim focus is still pulling the authoritative body for this Task. */
	bodyLoading?: boolean;
	stickToBottomRef: RefObject<boolean | null>;
	/** ADR-0012: near-top scroll may request older Turns (single-flight owned by caller). */
	onNearTop?: () => void;
	/** PlanBuild dock Stop — cancel active run. */
	onStopPlanBuild?: () => void;
	/**
	 * Keep-alive: false hides this pane (`display:none`) without unmounting, so
	 * switching back reuses the mounted DOM. Unhide re-pins to bottom.
	 */
	visible?: boolean;
	className?: string;
};

/**
 * Transcript list. Absolute virtualization is currently disabled (`FLOW_ONLY_MAX`):
 * all rows use document flow. Flow sections wrap each user prompt with following
 * reply rows so the prompt can `position: sticky` for the turn. Stick-to-bottom +
 * Jump-to-latest still apply.
 */
/**
 * One transcript turn block (刀 5b). Memo boundary: frozen sections keep object
 * identity (`stableTranscriptSections`) and `renderItem`/`onStopPlanBuild` are
 * stable callbacks, so streaming frames reconcile only the live section.
 */
const FlowSection = memo(function FlowSection({
	section,
	topGap,
	renderItem,
	onStopPlanBuild
}: {
	section: TranscriptSection;
	topGap: boolean;
	renderItem: (item: TimelineItem) => ReactNode;
	onStopPlanBuild?: () => void;
}) {
	bumpTabRowRender();
	return (
		<div className={cn('flex w-full flex-col gap-3', topGap && 'mt-5')}>
			{section.user ? (
				<div
					className={cn(
						'sticky top-0 z-10 bg-background',
						section.user.planBuild ? 'py-0' : 'py-1'
					)}
					data-turn-id={section.user.id}
				>
					{section.user.planBuild ? (
						<div className="flex w-full flex-col gap-0">
							{renderItem({
								...section.user,
								showStop: false
							})}
							<BuildDock
								planId={section.user.planBuild.planId}
								name={section.user.planBuild.name}
								plan={section.user.planBuild.plan}
								canStop={Boolean(section.user.showStop)}
								onStop={onStopPlanBuild}
							/>
						</div>
					) : (
						renderItem(section.user)
					)}
				</div>
			) : null}
			{section.items.map(item => (
				<div
					key={`${item.kind}-${item.id}`}
					className="w-full"
					data-turn-id={item.id}
					/*
					 * 刀 7: offscreen reply rows skip layout/paint while staying in
					 * the DOM (Cmd+F / copy semantics survive). `auto <estimate>`
					 * remembers the measured height after first reveal, reducing
					 * scrollbar correction on return visits. The sticky user row
					 * is deliberately the sibling above, outside containment.
					 */
					style={flowContentVisibilityStyle(item)}
				>
					{renderItem(item)}
				</div>
			))}
		</div>
	);
});

const EMPTY_STAGING: TranscriptStagingState = {
	key: null,
	total: 0,
	visible: 0,
	phase: 'complete'
};

/** Idle slice for backfill mounts; timeout bounds latency when the thread is busy. */
function requestIdleSlice(cb: () => void): () => void {
	if (typeof window.requestIdleCallback === 'function') {
		const id = window.requestIdleCallback(() => cb(), {timeout: 500});
		return () => window.cancelIdleCallback(id);
	}
	const id = window.setTimeout(cb, 200);
	return () => window.clearTimeout(id);
}

/**
 * 刀 9 (windowed): every visit mounts only the interactive tail window — a rAF
 * reveal on first visit, straight to the window on revisit (A→B→A). Older
 * sections mount via idle backfill (paused while the user reads history
 * unpinned) or via near-top reveal. Switch cost stays O(window) regardless of
 * conversation length.
 */
function useTranscriptStaging(
	taskId: string | null,
	total: number,
	loading: boolean,
	pinnedRef: RefObject<boolean | null>
): {state: TranscriptStagingState; revealOlder: () => void} {
	const visitedTaskIds = useRef(new Set<string>());
	const [stored, setStored] = useState<TranscriptStagingState>(EMPTY_STAGING);
	const revisited = taskId ? visitedTaskIds.current.has(taskId) : true;
	const input = useMemo(
		() => ({key: taskId, total, loading, revisited}),
		[taskId, total, loading, revisited]
	);
	const inputRef = useRef(input);
	inputRef.current = input;
	const state = useMemo(
		() => reconcileTranscriptStaging(stored, input),
		[stored, input]
	);

	useEffect(() => {
		if (state !== stored) setStored(state);
		if (state.key && (state.phase === 'backfill' || state.phase === 'complete')) {
			visitedTaskIds.current.add(state.key);
		}
	}, [state, stored]);

	const syncedAdvance = useCallback(
		(key: string | null, phase: TranscriptStagingState['phase'], batch?: number) => {
			setStored(latest => {
				const synced = reconcileTranscriptStaging(latest, {
					...inputRef.current,
					revisited: Boolean(key && visitedTaskIds.current.has(key))
				});
				if (synced.key !== key || synced.phase !== phase) return synced;
				return advanceTranscriptStaging(synced, batch);
			});
		},
		[]
	);

	// Staging: rAF-paced reveal up to the interactive tail window.
	useEffect(() => {
		if (state.phase !== 'staging') return;
		const frameKey = state.key;
		const frame = requestAnimationFrame(() => {
			syncedAdvance(frameKey, 'staging');
		});
		return () => cancelAnimationFrame(frame);
	}, [state, syncedAdvance]);

	// Backfill: idle-paced single-section mounts wrapped in a transition so
	// typing/scrolling stays responsive; paused while the user reads history.
	useEffect(() => {
		if (state.phase !== 'backfill') return;
		const key = state.key;
		let cancelled = false;
		let cancelIdle: () => void = () => {};
		const step = () => {
			if (cancelled) return;
			if (pinnedRef.current === false) {
				cancelIdle = requestIdleSlice(step);
				return;
			}
			startTransition(() => {
				syncedAdvance(key, 'backfill', TRANSCRIPT_BACKFILL_BATCH_SECTIONS);
			});
		};
		cancelIdle = requestIdleSlice(step);
		return () => {
			cancelled = true;
			cancelIdle();
		};
	}, [state, pinnedRef, syncedAdvance]);

	/** Near-top: user is reading history — page older sections in immediately. */
	const revealOlder = useCallback(() => {
		setStored(latest => {
			const synced = reconcileTranscriptStaging(latest, inputRef.current);
			if (synced.phase !== 'staging' && synced.phase !== 'backfill') return synced;
			return advanceTranscriptStaging(synced, TRANSCRIPT_REVEAL_PAGE_SECTIONS);
		});
	}, []);

	return {state, revealOlder};
}

export function VirtualTranscript({
	items,
	header,
	renderItem,
	scrollKey,
	activeTaskId,
	bodyLoading = false,
	stickToBottomRef,
	onNearTop,
	onStopPlanBuild,
	visible = true,
	className
}: VirtualTranscriptProps) {
	const parentRef = useRef<HTMLDivElement>(null);
	const pinUntilRef = useRef(0);
	const [showJump, setShowJump] = useState(false);
	const prependAnchorRef = useRef<{
		scrollHeight: number;
		scrollTop: number;
		firstKey: string;
	} | null>(null);
	/** 刀 4: precise programmatic-scroll mark (replaces pure time-window heuristics). */
	const autoMarkRef = useRef<AutoScrollMark | null>(null);
	/** 刀 4: last wheel-up inside a `[data-scrollable]` region (bubbling artifact guard). */
	const nestedWheelAtRef = useRef(0);

	const useVirtual = items.length > FLOW_ONLY_MAX;
	const splitAt = useVirtual ? transcriptFlowSplitAt(items.length) : 0;
	const headItems = useMemo(() => items.slice(0, splitAt), [items, splitAt]);
	const tailItems = useMemo(() => items.slice(splitAt), [items, splitAt]);

	const virtualizer = useVirtualizer({
		count: headItems.length,
		getScrollElement: () => parentRef.current,
		estimateSize: index => estimateTimelineRowPx(headItems[index] ?? {kind: 'system'}),
		overscan: 8,
		getItemKey: index => {
			const item = headItems[index]!;
			return `${item.kind}-${item.id}`;
		}
	});

	function scrollViewportToAbsoluteBottom() {
		const viewport = parentRef.current;
		if (!viewport) return;
		viewport.scrollTop = viewport.scrollHeight;
	}

	function pinFollow(ms = 450) {
		stickToBottomRef.current = true;
		setShowJump(false);
		pinUntilRef.current = Date.now() + ms;
	}

	function followBottom() {
		// 刀 4: skip the write (and its forced layout) when already at bottom —
		// the mark still updates so late scroll events classify as programmatic.
		const viewport = parentRef.current;
		if (!viewport) return;
		const plan = followWritePlan(
			{
				scrollHeight: viewport.scrollHeight,
				scrollTop: viewport.scrollTop,
				clientHeight: viewport.clientHeight
			},
			Date.now()
		);
		autoMarkRef.current = plan.mark;
		if (!plan.write) return;
		scrollViewportToAbsoluteBottom();
		// One rAF verify instead of the old double-rAF triple-write (P2-11):
		// late layout growth (images) is separately covered by the ResizeObserver.
		requestAnimationFrame(() => {
			const vp = parentRef.current;
			if (!vp) return;
			const verify = followWritePlan(
				{scrollHeight: vp.scrollHeight, scrollTop: vp.scrollTop, clientHeight: vp.clientHeight},
				Date.now()
			);
			autoMarkRef.current = verify.mark;
			if (verify.write) vp.scrollTop = vp.scrollHeight;
		});
	}

	function remeasureHead() {
		if (headItems.length === 0) return;
		virtualizer.measure();
	}

	// Content growth: always invalidate height cache; follow only when pinned.
	// Shrink (D10 regenerate hides victim rows): compensate the viewport anchor
	// so a non-following reader keeps their position instead of being clamped.
	const prevViewportRef = useRef<ViewportMetrics | null>(null);
	useEffect(() => {
		const viewport = parentRef.current;
		if (!viewport || items.length === 0) {
			prevViewportRef.current = null;
			return;
		}
		remeasureHead();
		const after: ViewportMetrics = {
			scrollHeight: viewport.scrollHeight,
			scrollTop: viewport.scrollTop,
			clientHeight: viewport.clientHeight
		};
		const plan = shrinkWritePlan(prevViewportRef.current, after, stickToBottomRef.current === true);
		if (plan.write && plan.scrollTop !== undefined) viewport.scrollTop = plan.scrollTop;
		prevViewportRef.current = {
			scrollHeight: viewport.scrollHeight,
			scrollTop: viewport.scrollTop,
			clientHeight: viewport.clientHeight
		};
		if (!stickToBottomRef.current) return;
		setShowJump(false);
		followBottom();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [scrollKey, items.length, headItems.length]);

	useEffect(() => {
		prependAnchorRef.current = null;
		revealAnchorRef.current = null;
		pinFollow(450);
		requestAnimationFrame(() => followBottom());
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeTaskId]);

	// Keep-alive unhide: display:none dropped the scroll state — land at the
	// bottom again, same as a fresh task switch.
	useEffect(() => {
		if (!visible) return;
		prependAnchorRef.current = null;
		revealAnchorRef.current = null;
		pinFollow(450);
		const frame = requestAnimationFrame(() => followBottom());
		return () => cancelAnimationFrame(frame);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [visible]);

	// Latest values for the stable scroll listener — re-attaching the listener
	// per streamed frame (old deps included items.length) was churn (P2-11).
	const itemCountRef = useRef(items.length);
	itemCountRef.current = items.length;
	const firstItemKeyRef = useRef<string | null>(null);
	firstItemKeyRef.current = items[0] ? `${items[0].kind}-${items[0].id}` : null;
	const onNearTopRef = useRef(onNearTop);
	onNearTopRef.current = onNearTop;
	const isStagingRef = useRef(false);
	/** Window still open (staging/backfill): near-top reveals locally, not via engine. */
	const windowOpenRef = useRef(false);
	const revealOlderRef = useRef<() => void>(() => {});
	/** Scroll anchor for a near-top local reveal (compensated after commit). */
	const revealAnchorRef = useRef<{scrollHeight: number; scrollTop: number} | null>(null);

	useEffect(() => {
		const viewport = parentRef.current;
		if (!viewport) return;
		const onScroll = () => {
			const now = Date.now();
			// Ignore programmatic follow scroll; don't force-stick (user may be leaving).
			if (shouldIgnoreScrollProximity(pinUntilRef.current, now)) return;
			if (isStagingRef.current) {
				stickToBottomRef.current = true;
				setShowJump(false);
				return;
			}
			const remaining = remainingScrollPx(
				viewport.scrollHeight,
				viewport.scrollTop,
				viewport.clientHeight
			);
			const nearBottom = isNearBottom(remaining, NEAR_BOTTOM_PX);
			if (!nearBottom) {
				// 刀 4: our own follow write (precise mark) or a nested-scrollable
				// wheel bubbling artifact must not unstick the user.
				if (isAutoScroll(autoMarkRef.current, viewport.scrollTop, now)) return;
				if (isNestedWheelArtifact(nestedWheelAtRef.current, now)) return;
			}
			stickToBottomRef.current = nearBottom;
			setShowJump(!nearBottom && itemCountRef.current > 0);
			const nearTopFn = onNearTopRef.current;
			const firstKey = firstItemKeyRef.current;
			if (!isNearTop(viewport.scrollTop, NEAR_TOP_PX)) return;
			if (windowOpenRef.current) {
				// Unmounted local sections remain — reveal them before ever asking
				// the engine for older history.
				if (!revealAnchorRef.current) {
					revealAnchorRef.current = {
						scrollHeight: viewport.scrollHeight,
						scrollTop: viewport.scrollTop
					};
					revealOlderRef.current();
				}
			} else if (nearTopFn && firstKey) {
				prependAnchorRef.current = {
					scrollHeight: viewport.scrollHeight,
					scrollTop: viewport.scrollTop,
					firstKey
				};
				nearTopFn();
			}
		};
		// 刀 4: wheel-up = explicit intent to read history — unstick immediately;
		// wheel-up inside `[data-scrollable]` scrolls that region, never the follow.
		const onWheel = (e: WheelEvent) => {
			if (isStagingRef.current) return;
			const target = e.target instanceof Element ? e.target : null;
			const nested = target?.closest<HTMLElement>('[data-scrollable]') ?? null;
			const nestedConsumes = nested
				? nestedScrollableConsumesWheel(
						{
							scrollHeight: nested.scrollHeight,
							scrollTop: nested.scrollTop,
							clientHeight: nested.clientHeight
						},
						e.deltaY
					)
				: false;
			const intent = wheelIntent(e.deltaY, nestedConsumes);
			if (intent === 'nested') {
				nestedWheelAtRef.current = Date.now();
				return;
			}
			if (intent !== 'leave-follow') return;
			if (viewport.scrollHeight - viewport.clientHeight <= 1) return;
			if (stickToBottomRef.current) {
				stickToBottomRef.current = false;
				setShowJump(itemCountRef.current > 0);
			}
		};
		viewport.addEventListener('scroll', onScroll, {passive: true});
		viewport.addEventListener('wheel', onWheel, {passive: true});
		// Do not call onScroll() here: after items grow, remainingPx looks large
		// until followBottom runs, which would falsely clear stick-to-bottom.
		return () => {
			viewport.removeEventListener('scroll', onScroll);
			viewport.removeEventListener('wheel', onWheel);
		};
	}, [activeTaskId, stickToBottomRef]);

	// Preserve reading position when older Turns are prepended.
	useEffect(() => {
		const viewport = parentRef.current;
		const anchor = prependAnchorRef.current;
		if (!viewport) return;
		const prepended =
			anchor != null &&
			items.findIndex(item => `${item.kind}-${item.id}` === anchor.firstKey) > 0;
		const plan = prependWritePlan(
			anchor,
			viewport.scrollHeight,
			prepended,
			Boolean(stickToBottomRef.current)
		);
		if (plan.consume) prependAnchorRef.current = null;
		if (plan.scrollTop != null) {
			viewport.scrollTop = plan.scrollTop;
			pinUntilRef.current = Math.max(pinUntilRef.current, Date.now() + 120);
		}
	}, [items, stickToBottomRef]);

	// Images / streaming markdown / collapsed thought can change height without
	// scrollKey. Observer attaches once (target div is stable); the callback
	// reads latest closures via ref — the old deps re-attached it per frame.
	const roHandlersRef = useRef({remeasure: remeasureHead, follow: followBottom});
	roHandlersRef.current = {remeasure: remeasureHead, follow: followBottom};
	useEffect(() => {
		const viewport = parentRef.current;
		if (!viewport) return;
		const target = viewport.firstElementChild;
		if (!target) return;
		const ro = new ResizeObserver(() => {
			roHandlersRef.current.remeasure();
			if (stickToBottomRef.current) roHandlersRef.current.follow();
		});
		ro.observe(target);
		return () => ro.disconnect();
	}, [stickToBottomRef]);

	function jumpToBottom() {
		prependAnchorRef.current = null;
		pinFollow(600);
		followBottom();
	}

	const virtualItems = headItems.length > 0 ? virtualizer.getVirtualItems() : [];
	// 刀 5b: unchanged prefix sections keep object identity across frames, so the
	// memo'd FlowSection skips their whole subtree — React reconciliation during
	// streaming touches only the live turn's section.
	const sectionsRef = useRef<SectionsSnapshot | null>(null);
	const sectionsTaskRef = useRef(activeTaskId);
	const flowSections = useMemo(() => {
		if (sectionsTaskRef.current !== activeTaskId) {
			sectionsTaskRef.current = activeTaskId;
			sectionsRef.current = null;
		}
		const snap = stableTranscriptSections(tailItems, sectionsRef.current);
		sectionsRef.current = snap;
		return snap.sections;
	}, [activeTaskId, tailItems]);
	const {state: staging, revealOlder} = useTranscriptStaging(
		activeTaskId,
		flowSections.length,
		bodyLoading,
		stickToBottomRef
	);
	const visibleFlowSections = useMemo(
		() => visibleTranscriptSections(flowSections, staging),
		[flowSections, staging]
	);
	const visibleSectionStart = flowSections.length - visibleFlowSections.length;
	const isStaging = staging.phase === 'staging';
	isStagingRef.current = isStaging;
	windowOpenRef.current = isStaging || staging.phase === 'backfill';
	revealOlderRef.current = revealOlder;

	if (activeTabFocusTaskId() === activeTaskId && activeTaskId) {
		markTabStaging({
			taskId: activeTaskId,
			phase: staging.phase,
			visible: staging.visible,
			total: staging.total,
			sections: flowSections.length
		});
	}

	// Each staged batch prepends DOM above the newest Turn. Keep the cold mount
	// pinned; ResizeObserver handles the final batch that seals staging.
	useEffect(() => {
		if (!isStaging) return;
		pinFollow(450);
		const frame = requestAnimationFrame(() => followBottom());
		return () => cancelAnimationFrame(frame);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeTaskId, isStaging, staging.visible]);

	// Near-top local reveal prepends DOM above an unpinned reader — restore the
	// viewport by the height delta before paint (same math as prependWritePlan).
	useLayoutEffect(() => {
		const viewport = parentRef.current;
		const anchor = revealAnchorRef.current;
		if (!viewport || !anchor) return;
		revealAnchorRef.current = null;
		if (stickToBottomRef.current) return;
		viewport.scrollTop = anchor.scrollTop + (viewport.scrollHeight - anchor.scrollHeight);
		pinUntilRef.current = Math.max(pinUntilRef.current, Date.now() + 120);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [visibleSectionStart]);

	return (
		/*
		 * Keep-alive hiding uses content-visibility:hidden (not display:none):
		 * Chromium preserves the subtree's rendering state, so unhiding skips the
		 * full style/layout pass that display:none→block forces (~100ms on long
		 * threads). The zero-height box keeps it out of flex layout; inert keeps
		 * it out of focus/a11y/find-in-page.
		 */
		<div
			inert={!visible || undefined}
			className={cn(
				'relative min-h-0',
				visible
					? 'flex-1'
					: 'h-0 flex-none overflow-hidden [content-visibility:hidden] pointer-events-none',
				className
			)}
		>
			{/* 刀 4: explicit overflow-anchor none — the manual prepend compensation is
			    authoritative; browser anchoring on top of it double-shifts. */}
			<div ref={parentRef} className="h-full overflow-y-auto [overflow-anchor:none]">
				<div
					className={cn(
						'mx-auto flex max-w-3xl flex-col gap-3 p-4',
						items.length === 0 && 'min-h-full justify-center'
					)}
				>
					{header}
					{headItems.length > 0 ? (
						<div
							className="relative w-full overflow-x-clip"
							style={{height: `${virtualizer.getTotalSize()}px`}}
						>
							{virtualItems.map(row => {
								const item = headItems[row.index]!;
								return (
									<div
										key={row.key}
										data-index={row.index}
										data-turn-id={item.id}
										ref={virtualizer.measureElement}
										className="absolute top-0 left-0 w-full pb-3"
										style={{transform: `translateY(${row.start}px)`}}
									>
										{renderItem(item)}
									</div>
								);
							})}
						</div>
					) : null}
					{/* Document-flow sections: user prompt sticky within its turn block. */}
					{visibleFlowSections.map((section, sectionIndex) => (
						<FlowSection
							key={section.id}
							section={section}
							topGap={
								Boolean(section.user) &&
								sectionIndex + visibleSectionStart > 0
							}
							renderItem={renderItem}
							onStopPlanBuild={onStopPlanBuild}
						/>
					))}
				</div>
			</div>
			{showJump && !isStaging ? (
				<div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
					<Button
						type="button"
						size="sm"
						variant="secondary"
						className="pointer-events-auto gap-1.5 rounded-full shadow-md"
						onClick={jumpToBottom}
					>
						<ArrowDown className="size-3.5" />
						Jump to latest
					</Button>
				</div>
			) : null}
		</div>
	);
}
