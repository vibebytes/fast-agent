import React, {useEffect, useId, useMemo, useRef} from 'react';
import {Box, Text} from 'ink';
import {SmoothText} from './SmoothText.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {useOverflowReport} from '../contexts/OverflowContext.js';
import {useSharedSpinnerFrame} from '../hooks/useSharedSpinner.js';
import {useTerminalSize} from '../hooks/useTerminalSize.js';
import {hardWrap, tailLines, truncateEnd} from '../utils/textWidth.js';
import {STR} from '../ui/strings.js';

type Props = {
	text: string;
	running: boolean;
	compact?: boolean;
	collapsed?: boolean;
	hideBody?: boolean;
	/** ADR-0005: replaces Thinking while reconnecting / waiting for network. */
	waitLabel?: string;
};

/** Running thinking body is clamped to this many visual rows (product behaviour). */
export const RUNNING_THINKING_ROWS = 4;

/** `Thinking ⠹ · 12s · ctrl+c 取消` — gradient spinner + elapsed + escape hatch. */
function RunningHeader({frame, index, label}: {frame: string; index: number; label: string}) {
	const {theme} = useTheme();
	const startedAtRef = useRef(Date.now());
	const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000));
	const spinnerColor = theme.spinner[index % theme.spinner.length] ?? theme.text.accent;

	return (
		<Text>
			<Text italic dimColor color={theme.text.muted}>{' '}{label} </Text>
			<Text color={spinnerColor}>{frame}</Text>
			<Text italic dimColor color={theme.text.muted}>
				{elapsedSeconds >= 1 ? ` · ${elapsedSeconds}s` : ''} · {STR.cancelHint}
			</Text>
		</Text>
	);
}

export function ThinkingBlock({text, running, compact, collapsed, hideBody, waitLabel}: Props) {
	const {theme} = useTheme();
	const {frame, index} = useSharedSpinnerFrame(running);
	const {columns} = useTerminalSize();

	// Restart the elapsed clock whenever a new run begins.
	const runEpochRef = useRef(0);
	const wasRunningRef = useRef(running);
	useEffect(() => {
		if (running && !wasRunningRef.current) {
			runEpochRef.current += 1;
		}
		wasRunningRef.current = running;
	}, [running]);

	// Body width inside the left-border box (marginLeft 1 + border 1 + padding 1).
	const bodyWidth = Math.max(16, columns - 3);

	// CRITICAL: while running, cap by VISUAL rows, not logical lines. Real
	// engines stream reasoning as one giant unbroken CJK paragraph — a single
	// logical "line" wraps to 10+ terminal rows. Fixed product clamp
	// (RUNNING_THINKING_ROWS; no live-region maxLines budget chain under the
	// scroll architecture). Memoized — this used to grapheme-split the whole
	// reasoning text on every shared-spinner frame (~120ms) while running.
	const clamped = useMemo(
		() => (running ? tailLines(hardWrap(text, bodyWidth), RUNNING_THINKING_ROWS, bodyWidth) : undefined),
		[running, text, bodyWidth]
	);
	// truncateEnd is width-accurate and grapheme-safe; a raw .slice() split
	// surrogate pairs and let 77 CJK chars span ~154 columns.
	const preview = clamped
		? clamped.text
		: compact && text.length > 80 ? truncateEnd(text, 77) : text;
	const lines = preview
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0 && !/^\.+$/.test(line));
	const [subject, ...body] = lines;

	const visibleBody = body;
	const hiddenThinkingCount = clamped?.hiddenLines ?? 0;

	const overflowId = useId();
	useOverflowReport(`thinking-${overflowId}`, hideBody ? 0 : hiddenThinkingCount);

	if (!running && text.trim().length === 0) {
		return null;
	}

	const headerLabel = waitLabel?.trim() || STR.thinking;

	if (hideBody) {
		return (
			<Box marginTop={compact ? 0 : 1} marginBottom={compact ? 0 : 1} flexDirection="row" width="100%">
				{running
					? <RunningHeader key={runEpochRef.current} frame={frame} index={index} label={headerLabel} />
					: <Text dimColor italic color={theme.text.muted}>{' '}Thought</Text>}
			</Box>
		);
	}

	if (collapsed && !running) {
		const summary = subject ? truncateEnd(subject, 56) : '';
		return (
			<Box marginTop={compact ? 0 : 1} marginBottom={compact ? 0 : 1} flexDirection="row" width="100%">
				<Text dimColor italic color={theme.text.muted}>
				{' '}▸ Thought{summary ? ` · ${summary}` : ''}
				</Text>
				<Text dimColor italic color={theme.text.muted}> · Ctrl+O 展开</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" marginTop={compact ? 0 : 1} marginBottom={compact ? 0 : 1} width="100%">
			<Box flexDirection="row" width="100%">
				{running
					? <RunningHeader key={runEpochRef.current} frame={frame} index={index} label={headerLabel} />
					: <Text dimColor italic color={theme.text.muted}>{' '}Thought</Text>}
			</Box>
			{lines.length > 0 && (
				<Box
					flexDirection="column"
					marginLeft={1}
					paddingLeft={1}
					borderStyle="single"
					borderLeft
					borderRight={false}
					borderTop={false}
					borderBottom={false}
					borderColor={theme.text.muted}
					width="100%"
				>
					{subject && (
						<Box flexDirection="row" width="100%">
							<Text
								italic
								dimColor
								color={
									running && visibleBody.length > 0
										? theme.text.muted
										: theme.text.secondary
								}
								wrap="wrap"
							>
								{running && !compact && visibleBody.length === 0 ? (
									<SmoothText text={subject} active dimTail={12} />
								) : (
									subject
								)}
							</Text>
						</Box>
					)}
					{visibleBody.map((line, index) => {
						const isNewest = index === visibleBody.length - 1;
						return (
							<Box key={index} flexDirection="row" width="100%">
								<Text
									italic
									dimColor
									color={
										running && !isNewest ? theme.text.muted : theme.text.secondary
									}
									wrap="wrap"
								>
									{running && !compact && isNewest ? (
										<SmoothText text={line} active dimTail={12} />
									) : (
										line
									)}
								</Text>
							</Box>
						);
					})}
					{hiddenThinkingCount > 0 && (
						<Box flexDirection="row" width="100%">
							<Text italic dimColor color={theme.text.muted} wrap="wrap">
								{STR.hiddenThinking(hiddenThinkingCount)}
							</Text>
						</Box>
					)}
				</Box>
			)}
		</Box>
	);
}
