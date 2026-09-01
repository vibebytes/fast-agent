/**
 * Unified transcript viewport: scrollable history + live pending items.
 * Settled items are frozen via StaticRender; pending items re-render freely.
 *
 * Scrollbar follows gemini-cli Scrollable: paddingRight for the thumb column,
 * thumb color near-invisible until scroll (useAnimatedScrollbar flash/fade).
 */
import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {
	Box,
	StaticRender,
	Text,
	useInput,
	getInnerHeight,
	getScrollHeight,
	type DOMElement
} from 'ink';
import type {UiState} from '../state/model.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {HistoryItemDisplay} from './HistoryItemDisplay.js';
import {AppHeader} from './AppHeader.js';
import {QueuePanel} from './QueuePanel.js';
import {turnsToTimeline, splitTimeline} from '../state/timeline/turnAdapter.js';
import {useTerminalSize} from '../hooks/useTerminalSize.js';
import {useMouseWheel} from '../hooks/useMouseWheel.js';
import {useHomeEndKeys} from '../hooks/useHomeEndKeys.js';
import {useFlickerDetector} from '../hooks/useFlickerDetector.js';
import {useAnimatedScrollbar} from '../hooks/useAnimatedScrollbar.js';
import {STR} from '../ui/strings.js';
import {
	initialScrollState,
	maxScrollTop,
	reduceScroll,
	type ScrollState
} from './transcriptScroll.js';
import {smoothScrollTo} from '../scroll/smoothScroll.js';

type Props = {
	state: UiState;
	/** When true, scrolled-out content goes to the terminal native scrollback. */
	overflowToBackbuffer?: boolean;
	/** Keep scrollback stable when content shrinks (inline mode). */
	stableScrollback?: boolean;
	/** Force stick-to-bottom (e.g. after submit / approval). */
	stickToken?: number;
	onQuestionAnswer?: (id: string, answer: string | {selectedOptionId?: string; customText?: string}) => void;
	/** Disable keyboard scrolling when a dialog owns input. */
	scrollActive?: boolean;
};

export type TranscriptHandle = {
	scrollToEnd: () => void;
	getScrollState: () => ScrollState;
};

/** Rows reserved below the viewport for composer / footer / notices. */
const VIEWPORT_RESERVED_ROWS = 6;

export const Transcript = React.forwardRef<TranscriptHandle, Props>(function Transcript(
	{
		state,
		overflowToBackbuffer = false,
		stableScrollback = false,
		stickToken = 0,
		onQuestionAnswer,
		scrollActive = true
	},
	ref
) {
	const {theme, themeName} = useTheme();
	const {columns, rows} = useTerminalSize();
	const scrollRef = useRef<DOMElement>(null);
	const liveRegionRef = useRef<DOMElement | null>(null);
	const [scroll, setScroll] = useState(() => initialScrollState(Math.max(4, rows - VIEWPORT_RESERVED_ROWS)));
	const scrollRefState = useRef(scroll);
	scrollRefState.current = scroll;
	const cancelSmoothRef = useRef<(() => void) | null>(null);
	/** Content width leaves one column for Ink's scrollbar thumb (gemini Scrollable). */
	const contentWidth = Math.max(1, columns - 1);

	const timeline = useMemo(() => turnsToTimeline(state), [state]);
	const {staticHistory, pendingItems} = useMemo(() => splitTimeline(timeline), [timeline]);

	const approvalPaused = state.transcript.approvals.length > 0;
	const visiblePending = pendingItems.filter(item => item.kind !== 'approval_message');
	// error_message is always excluded here: errors render once in AppLayout's
	// ErrorPanel (showing them here too duplicated every error while paused).
	const shownPending = approvalPaused
		? visiblePending.filter(item =>
			item.kind === 'question_message' || item.kind === 'system_message')
		: visiblePending.filter(item => item.kind !== 'error_message');

	useFlickerDetector(scrollRef, rows);

	const measure = useCallback(() => {
		if (!scrollRef.current) return;
		const innerHeight = getInnerHeight(scrollRef.current);
		const scrollHeight = getScrollHeight(scrollRef.current);
		setScroll(current => {
			let next = current;
			if (innerHeight !== current.innerHeight) {
				next = reduceScroll(next, {type: 'resize', innerHeight});
			}
			if (scrollHeight !== next.scrollHeight) {
				next = reduceScroll(next, {type: 'content', scrollHeight});
			}
			return next;
		});
	}, []);

	useLayoutEffect(() => {
		measure();
	});

	useEffect(() => {
		setScroll(current => reduceScroll(current, {type: 'forceStick'}));
	}, [stickToken]);

	const scrollBy = useCallback((delta: number) => {
		cancelSmoothRef.current?.();
		setScroll(current => reduceScroll(current, {type: 'scrollBy', delta}));
	}, []);

	const {scrollbarColor, flashScrollbar, scrollByWithAnimation} = useAnimatedScrollbar(
		scrollActive,
		scrollBy
	);

	const scrollToEnd = useCallback(() => {
		cancelSmoothRef.current?.();
		setScroll(current => reduceScroll(current, {type: 'scrollToEnd'}));
		flashScrollbar();
	}, [flashScrollbar]);

	const scrollToHome = useCallback(() => {
		cancelSmoothRef.current?.();
		setScroll(current => reduceScroll(current, {type: 'scrollTo', scrollTop: 0}));
		flashScrollbar();
	}, [flashScrollbar]);

	React.useImperativeHandle(ref, () => ({
		scrollToEnd,
		getScrollState: () => scrollRefState.current
	}), [scrollToEnd]);

	useInput((_input, key) => {
		if (key.pageUp) {
			cancelSmoothRef.current?.();
			flashScrollbar();
			cancelSmoothRef.current = smoothScrollTo({
				from: scrollRefState.current.scrollTop,
				to: scrollRefState.current.scrollTop - scrollRefState.current.innerHeight,
				max: Math.max(0, scrollRefState.current.scrollHeight - scrollRefState.current.innerHeight),
				onFrame: value => setScroll(current => reduceScroll(current, {type: 'scrollTo', scrollTop: value}))
			});
			return;
		}
		if (key.pageDown) {
			cancelSmoothRef.current?.();
			flashScrollbar();
			cancelSmoothRef.current = smoothScrollTo({
				from: scrollRefState.current.scrollTop,
				to: scrollRefState.current.scrollTop + scrollRefState.current.innerHeight,
				max: Math.max(0, scrollRefState.current.scrollHeight - scrollRefState.current.innerHeight),
				onFrame: value => setScroll(current => reduceScroll(current, {type: 'scrollTo', scrollTop: value}))
			});
			return;
		}
	}, {isActive: scrollActive});

	// Only when scrolled away from bottom — while sticking, Home/End belong to
	// the composer cursor (TextEntry). End while non-sticking restores follow.
	useHomeEndKeys(scrollActive && !scroll.isSticking, scrollToHome, scrollToEnd);

	useMouseWheel(
		scrollActive,
		direction => scrollByWithAnimation(direction === 'up' ? -1 : 1),
		{
			// Fullscreen (no backbuffer overflow) always enables mouse wheel;
			// inline keeps the FAST_MOUSE=1 opt-in to avoid corrupting input in
			// quirky multiplexers.
			force: !overflowToBackbuffer
		}
	);

	// deps MUST include contentWidth and toolsExpanded: the ink fork only
	// invalidates a StaticRender cache when deps change, so without them a
	// terminal resize keeps stale-width wraps and Ctrl+O never repaints
	// settled tool/thinking cards still inside the viewport.
	const toolsExpanded = state.toolsExpanded;
	const historyBlocks = useMemo(
		() => staticHistory.map(item => (
			<StaticRender key={item.id} width={contentWidth} deps={[item.id, themeName, contentWidth, toolsExpanded]}>
				{() => (
					<Box width={contentWidth} flexDirection="column">
						<HistoryItemDisplay item={item} onQuestionAnswer={onQuestionAnswer} />
					</Box>
				)}
			</StaticRender>
		)),
		[staticHistory, contentWidth, themeName, toolsExpanded, onQuestionAnswer]
	);

	return (
		<Box flexDirection="column" width={columns} flexGrow={1} height="100%">
			<Box
				ref={scrollRef}
				flexGrow={1}
				height={Math.max(4, rows - VIEWPORT_RESERVED_ROWS)}
				flexDirection="column"
				overflowY="scroll"
				scrollTop={scroll.scrollTop}
				scrollbar
				scrollbarThumbColor={scrollbarColor}
				overflowToBackbuffer={overflowToBackbuffer}
				stableScrollback={stableScrollback}
				width="100%"
			>
				{/* paddingRight reserves the thumb column (gemini-cli Scrollable). */}
				<Box flexDirection="column" flexShrink={0} width="100%" paddingRight={1}>
					<StaticRender width={contentWidth} deps={[themeName, contentWidth]}>
						{() => (
							<Box width={contentWidth} flexDirection="column">
								<AppHeader />
							</Box>
						)}
					</StaticRender>
					{historyBlocks}
					<Box ref={liveRegionRef} flexDirection="column" width="100%">
						{shownPending.map(item => (
							<HistoryItemDisplay
								key={item.id}
								item={item}
								onQuestionAnswer={onQuestionAnswer}
							/>
						))}
						{approvalPaused && (
							<Text dimColor color={theme.text.muted} wrap="truncate">{STR.approvalPausedNotice}</Text>
						)}
					</Box>
					<QueuePanel items={state.queue} />
					{state.errors.length === 0 && state.transcript.entries.length === 0 && state.localTurns.length === 0 && state.ready && (
						<Text color={theme.text.muted} dimColor wrap="wrap">{STR.readyHint}</Text>
					)}
				</Box>
			</Box>
			{!scroll.isSticking && (
				<Text dimColor color={theme.text.muted} wrap="truncate">
					{/* Distance from the bottom — NOT scrollTop (distance from top). */}
					{STR.scrolledUpHint(Math.max(1, Math.round(maxScrollTop(scroll) - scroll.scrollTop)))}
				</Text>
			)}
		</Box>
	);
});

