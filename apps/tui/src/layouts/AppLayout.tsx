/**
 * Unified app layout: one Transcript viewport covers both inline
 * (overflowToBackbuffer) and fullscreen (alternateBuffer) modes.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
	Box,
	Text,
	useApp,
	useInput,
	hitTest,
	Range,
	comparePoints,
	type DOMElement
} from 'ink';
import {Composer} from '../components/Composer.js';
import {Footer} from '../components/Footer.js';
import {SubagentFooter} from '../components/SubagentFooter.js';
import {DialogManager} from '../components/DialogManager.js';
import {ApprovalDialog} from '../components/dialogs/ApprovalDialog.js';
import {Transcript, type TranscriptHandle} from '../components/Transcript.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {useUIState} from '../contexts/UIStateContext.js';
import {useUIActions} from '../contexts/UIActionsContext.js';
import {OverflowProvider, useOverflowState} from '../contexts/OverflowContext.js';
import {useRenderTelemetry, getRenderTelemetry} from '../hooks/useRenderTelemetry.js';
import {getFlickerFrameCount} from '../hooks/useFlickerDetector.js';
import {STR} from '../ui/strings.js';
import type {ActiveDialog} from '../dialogs/dialogState.js';
import type {RendererMode} from '../theme/themeStore.js';
import {Command, matchKeybinding} from '../input/keybindings.js';
import {
	initialCopyMode,
	osc52Copy,
	reduceCopyMode,
	type CopyModeState
} from '../selection/copyMode.js';
import {approvalsFromState} from '../state/model.js';

type Props = {
	dialog?: ActiveDialog;
	rendererMode: RendererMode;
	onCloseDialog: () => void;
	onQuestionAnswer: (id: string, answer: string | {selectedOptionId?: string; customText?: string}) => void;
	onResumeSession?: (sessionId: string) => void;
	onDeleteSession?: (sessionId: string) => void;
	/** Bare r/c quick keys (doc §8); availability computed in AppContainer. */
	onQuickKey?: (ch: 'r' | 'c') => void;
	quickActions?: {retry: boolean; cont: boolean};
};

export function AppLayout(props: Props) {
	return (
		<OverflowProvider>
			<AppLayoutInner {...props} />
		</OverflowProvider>
	);
}

function OverflowHint() {
	const {theme} = useTheme();
	const {totalHiddenLines} = useOverflowState();
	if (totalHiddenLines === 0) return null;
	return (
		<Text dimColor color={theme.text.muted} wrap="truncate">
			{STR.overflowAggregate(totalHiddenLines)}
		</Text>
	);
}

function ErrorPanel({errors}: {errors: string[]}) {
	const {theme} = useTheme();
	const visible = errors.slice(-3);
	if (visible.length === 0) return null;
	return (
		<Box flexDirection="column" flexShrink={0}>
			{visible.map((error, index) => (
				<Box key={`err-${errors.length - visible.length + index}`} flexDirection="row" width="100%">
					<Box width={2} flexShrink={0}>
						<Text color={theme.status.danger}>✗ </Text>
					</Box>
					<Box flexGrow={1}>
						<Text color={theme.status.danger} wrap="wrap">{error}</Text>
					</Box>
				</Box>
			))}
		</Box>
	);
}

function AppLayoutInner({
	dialog,
	rendererMode,
	onCloseDialog,
	onQuestionAnswer,
	onResumeSession,
	onDeleteSession,
	onQuickKey,
	quickActions
}: Props) {
	const {state, dispatch} = useUIState();
	const {submitInput, send, cancelTask, queryMentions, mentionGroups, mentionRequestId} = useUIActions();
	const {theme} = useTheme();
	const {selection} = useApp();
	useRenderTelemetry();
	const telemetry = getRenderTelemetry();
	const transcriptRef = useRef<TranscriptHandle>(null);
	const rootRef = useRef<DOMElement>(null);
	const [stickToken, setStickToken] = useState(0);
	const [copyMode, setCopyMode] = useState<CopyModeState>(initialCopyMode);
	const copyModeRef = useRef(copyMode);
	copyModeRef.current = copyMode;

	const isAltBuf = rendererMode === 'fullscreen';
	const sessionId = state.sessionId;
	const fetchAgentTimeline = useCallback((agentId: string) => {
		if (sessionId) send({type: 'FetchAgentTimeline', sessionId, agentId});
	}, [send, sessionId]);

	const approvals = approvalsFromState(state);
	const approvalCount = approvals.length;
	const turnCount = state.transcript.entries.length + state.localTurns.length;
	useEffect(() => {
		setStickToken(token => token + 1);
	}, [approvalCount, turnCount]);

	// Sync Ink Selection ranges from copy-mode anchor/focus points.
	useEffect(() => {
		if (!selection) return;
		selection.removeAllRanges();
		if (!copyMode.active || !copyMode.anchor || !copyMode.focus) return;
		const range = new Range();
		const cmp = comparePoints(
			copyMode.anchor.node,
			copyMode.anchor.offset,
			copyMode.focus.node,
			copyMode.focus.offset
		);
		if (cmp <= 0) {
			range.setStart(copyMode.anchor.node, copyMode.anchor.offset);
			range.setEnd(copyMode.focus.node, copyMode.focus.offset);
		} else {
			range.setStart(copyMode.focus.node, copyMode.focus.offset);
			range.setEnd(copyMode.anchor.node, copyMode.anchor.offset);
		}
		selection.addRange(range);
	}, [selection, copyMode]);

	const confirmCopy = useCallback(() => {
		const text = selection?.toString() ?? '';
		if (text.length === 0) {
			dispatch({type: 'notice', text: '未选中文本'});
			setCopyMode(initialCopyMode());
			selection?.removeAllRanges();
			return;
		}
		process.stdout.write(osc52Copy(text));
		dispatch({type: 'notice', text: `已复制 ${text.length} 字符`});
		setCopyMode(initialCopyMode());
		selection?.removeAllRanges();
	}, [selection, dispatch]);

	useInput((input, key) => {
		const cmd = matchKeybinding({input, key});
		const current = copyModeRef.current;

		if (key.ctrl && input === 'y') {
			if (current.active) {
				confirmCopy();
			} else {
				const root = rootRef.current;
				const point = root ? hitTest(root, 0, 0) : undefined;
				setCopyMode(reduceCopyMode(initialCopyMode(), {
					type: 'enter',
					cursor: {x: 0, y: 0},
					point: point ?? undefined
				}));
				dispatch({type: 'notice', text: '复制模式：方向键移动 · Shift 扩选 · Ctrl+Y 确认 · Esc 取消'});
			}
			return;
		}

		if (current.active && key.escape) {
			setCopyMode(initialCopyMode());
			selection?.removeAllRanges();
			dispatch({type: 'notice', text: '已退出复制模式'});
			return;
		}

		if (current.active && (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow)) {
			const root = rootRef.current;
			if (!root) return;
			let {x, y} = current.cursor;
			if (key.upArrow) y = Math.max(0, y - 1);
			if (key.downArrow) y += 1;
			if (key.leftArrow) x = Math.max(0, x - 1);
			if (key.rightArrow) x += 1;
			const point = hitTest(root, x, y);
			setCopyMode(reduceCopyMode(current, {
				type: 'move',
				x,
				y,
				point: point ?? undefined,
				extend: key.shift === true
			}));
			return;
		}

		if (cmd === Command.ESCAPE && !current.active && !dialog) {
			// Single Esc arbiter (ink broadcasts keys to every active useInput,
			// so cancel-on-Esc must NOT live in a second handler):
			// scrolled up → only return to bottom; a run is cancelled solely
			// from the sticking state, so reading history never kills the task.
			const scrollState = transcriptRef.current?.getScrollState();
			transcriptRef.current?.scrollToEnd();
			if (scrollState && !scrollState.isSticking) return;
			// Esc in a drill-down view means "back to parent" (SubagentFooter);
			// approval/question prompts keep their own Esc semantics (deny /
			// dismiss), so a run waiting on a decision is not cancelled here.
			if (state.running
				&& state.agentViewStack.entries.length === 0
				&& state.transcript.approvals.length === 0
				&& state.transcript.questions.length === 0) {
				cancelTask();
			}
		}
	}, {isActive: true});

	return (
		<Box ref={rootRef} flexDirection="column" width="100%" height="100%">
			<Transcript
				ref={transcriptRef}
				state={state}
				overflowToBackbuffer={!isAltBuf}
				stableScrollback={!isAltBuf}
				stickToken={stickToken}
				onQuestionAnswer={onQuestionAnswer}
				scrollActive={state.inputMode !== 'approval' && !dialog && !copyMode.active}
			/>

			{state.debugVisible && (
				<Box flexDirection="column" flexShrink={0} paddingX={1} width="100%">
					<Box width="100%">
						<Text color={theme.status.success}>● </Text>
						<Text color={theme.text.muted} wrap="wrap">
							LLM debug live{state.debugUrl ? ` → ${state.debugUrl}` : ' (starting…)'} · {state.llmRequests.length} requests · /debug to close
						</Text>
					</Box>
					<Box width="100%">
						<Text color={theme.text.muted} dimColor wrap="truncate">
							渲染 {telemetry.frames} 帧 · 慢帧(&gt;200ms) {telemetry.slowFrames} · 最慢 {telemetry.worstFrameMs}ms · flicker {getFlickerFrameCount()}
							{copyMode.active ? ' · COPY' : ''}
						</Text>
					</Box>
				</Box>
			)}

			<Box flexDirection="column" flexShrink={0} marginTop={1}>
				{dialog && (
					<DialogManager
						dialog={dialog}
						onClose={onCloseDialog}
						onResumeSession={onResumeSession}
						onDeleteSession={onDeleteSession}
					/>
				)}
				{approvals.at(-1) && <ApprovalDialog approval={approvals.at(-1)!} />}
				{/* Goal confirm/running cards removed — status lives in host drawer / goal_updated. */}
				<OverflowHint />
				<ErrorPanel errors={state.errors} />
				<SubagentFooter state={state} dispatch={dispatch} onNavigate={fetchAgentTimeline} />
				{copyMode.active ? (
					<Text dimColor color={theme.text.muted} wrap="truncate">
						复制模式 · 方向键移动 · Shift 扩选 · Ctrl+Y 确认 · Esc 取消
					</Text>
				) : (
					<Composer
						ready={state.ready}
						mode={state.inputMode}
						onClearQueue={() => dispatch({type: 'clear_queue'})}
						onMentionQuery={queryMentions}
						mentionGroups={mentionGroups}
						mentionRequestId={mentionRequestId}
						onQuickKey={onQuickKey}
						quickActions={quickActions}
						onSubmit={(text, mentions) => {
							setStickToken(token => token + 1);
							submitInput(text, mentions);
						}}
					/>
				)}
				<Footer state={state} />
			</Box>
		</Box>
	);
}
