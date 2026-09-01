import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import type {ToolDisplayModel} from '../../tools/toolMapping.js';
import type {ToolTimelineProps} from './ToolGroupMessage.js';
import {ToolTimelinePrefix, ToolTimelineContinuation} from './ToolTimelineRow.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useOverflowReport} from '../../contexts/OverflowContext.js';
import {fitTerminalLine, getTerminalStringWidth, truncateEnd, truncateMiddle} from '../../theme/semanticTheme.js';
import {isScreenReader} from '../../terminal/capabilityManager.js';
import {useTerminalSize} from '../../hooks/useTerminalSize.js';
import {STR} from '../../ui/strings.js';

type Props = {model: ToolDisplayModel; compact?: boolean; timeline?: ToolTimelineProps; maxLines?: number};

type OutputLine = {stream: string; text: string};

/** Rows a bordered card adds on top of its content (top + bottom border). */
export const SHELL_CARD_OVERHEAD = 2;

/** Redirection noise (`2>/dev/null`, `2>&1`, …) that buries the real command. */
const REDIRECT_NOISE_RE = /((?:[012&]?>>?|<)\s*(?:\/dev\/null|&[012])|2>&1)/g;

/**
 * Command styling (Cursor-style emphasis hierarchy):
 * - the program name (first word) gets the accent color — the eye lands on
 *   WHAT runs before parsing its arguments;
 * - redirection plumbing (`2>/dev/null`, `2>&1`, …) is dimmed to noise;
 * - everything else stays primary.
 */
function CommandText({command}: {command: string}) {
	const {theme} = useTheme();
	const programMatch = /^(\s*[A-Za-z0-9_./-]+)([\s\S]*)$/.exec(command);
	const program = programMatch?.[1] ?? '';
	const rest = programMatch?.[2] ?? command;
	const parts = rest.split(REDIRECT_NOISE_RE);
	return (
		<>
			{program.length > 0 && <Text color={theme.text.accent}>{program}</Text>}
			{parts.map((part, index) =>
				index % 2 === 1
					? <Text key={index} dimColor color={theme.text.muted}>{part}</Text>
					: <Text key={index} color={theme.text.primary}>{part}</Text>
			)}
		</>
	);
}

/**
 * Shell block as a status-colored card (gemini-cli route, user-chosen):
 * the whole block (header + output) sits inside a rounded border whose color
 * carries the status — green success, red failure, orange denied, blue while
 * running. The border replaces the `⎿` elbow grammar inside shell blocks.
 *
 * Vertical economy: a card costs 2 extra rows, so header-only blocks
 * (compact success with no body to show) stay borderless single lines.
 * Screen readers skip the border entirely — box-drawing chars are noise.
 */
export function ShellToolMessage({model, compact, timeline, maxLines}: Props) {
	const {theme} = useTheme();
	const {columns, rows: terminalRows} = useTerminalSize();
	const caps = {width: columns, height: terminalRows};
	const isRunning = model.status === 'running';
	const isFailure = model.status === 'failed' || model.status === 'denied';

	// Live elapsed while running (the card sits in the live region, so a 1s
	// re-render is free); the tick stops the moment the tool settles.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!isRunning || model.startedAt === undefined) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		timer.unref?.();
		return () => clearInterval(timer);
	}, [isRunning, model.startedAt]);
	const elapsedSeconds = isRunning && model.startedAt !== undefined
		? Math.max(0, Math.floor((now - model.startedAt) / 1000))
		: undefined;

	// Multi-line commands (scripts with `;`/`&&` line breaks, heredocs) must
	// render as explicit rows: a raw `\n` inside the single header <Text>
	// stretches the card and tears the border layout apart.
	const commandLines = (model.command ?? '')
		.split('\n')
		.map(line => line.trimEnd())
		.filter((line, index) => index === 0 || line.trim().length > 0);
	const [firstCommandLine = '', ...restCommandLines] = commandLines;
	const commandRows = model.expanded ? restCommandLines : restCommandLines.slice(0, 3);
	const hiddenCommandRows = restCommandLines.length - commandRows.length;

	// Flatten chunks into tagged lines, preserving arrival order — closer to
	// what the user's own terminal would have shown than a stdout/stderr split.
	// Single blank lines survive (git log / pytest rely on them for paragraph
	// structure); runs of blanks collapse and edges trim so the row budget is
	// not wasted on padding.
	const rawLines: OutputLine[] = model.output.flatMap(chunk =>
		chunk.text.split('\n')
			.map(line => line.replace(/\r$/, ''))
			.map(line => ({stream: chunk.stream, text: line.trim().length === 0 ? ' ' : line}))
	);
	const lines: OutputLine[] = [];
	for (const line of rawLines) {
		if (line.text === ' ' && (lines.length === 0 || lines.at(-1)!.text === ' ')) continue;
		lines.push(line);
	}
	while (lines.at(-1)?.text === ' ') lines.pop();

	const budget = model.expanded
		// Subtract the card frame so an expanded card never outgrows the slice
		// of viewport the old flat layout was budgeted for.
		? Math.max(8, (maxLines ?? Math.floor(caps.height * 0.45)) - SHELL_CARD_OVERHEAD)
		: compact && !isFailure
			? 2
			: 3; // Hard cap when collapsed, to prevent terminal overflow.

	// Folding 1-2 lines is a net loss: the "+N 行" hint occupies a row itself,
	// so hiding that little saves nothing while costing a Ctrl+O.
	const effectiveBudget = lines.length <= budget + 2 ? lines.length : budget;
	// While running: live tail (claude-code/gemini-cli style) — the user sees
	// what the command is producing right now, capped at 2 rows for stability.
	// Settled cards ALSO preview the tail: failures because the error lives
	// there, successes because the conclusion does (`added 1361 packages…`) —
	// and a tail→tail transition means streamed output doesn't visibly jump
	// the moment the command finishes. Failures render their tail even in
	// compact mode: a silent ✗ is the worst possible UX.
	const preview: OutputLine[] = isRunning
		? lines.slice(-2)
		: lines.slice(-effectiveBudget);
	const hiddenLines = isRunning ? 0 : Math.max(0, lines.length - preview.length);
	useOverflowReport(`shell-${model.id}`, hiddenLines);

	// Exit 0 yet every line is stderr → pipeline masked a failure (`ps bad-flag
	// | head`). Tag the header so ✓ + red output below doesn't look like a bug.
	const stderrOnly = !isRunning && !isFailure
		&& lines.length > 0 && lines.every(line => line.stream === 'stderr');
	// The elapsed counter occupies the same suffix slot the final duration will
	// take over, so the header doesn't reflow when the command settles.
	const suffix = [
		stderrOnly ? STR.stderrOnlyTag : undefined,
		model.status === 'denied' ? STR.deniedTag : undefined,
		model.status === 'failed' && model.exitCode ? `exit ${model.exitCode}` : undefined,
		model.status === 'failed' && !model.exitCode ? STR.failedTag : undefined,
		elapsedSeconds !== undefined && elapsedSeconds >= 1 ? `${elapsedSeconds}s` : undefined,
		model.duration
	].filter(Boolean).join(' · ');

	const useCard = !isScreenReader();
	// Body rows the card would frame; without any, a border is pure cost.
	const hasBody = preview.length > 0 || hiddenLines > 0 || commandRows.length > 0
		|| isRunning || (isFailure && lines.length === 0);
	const asCard = useCard && hasBody;

	// Inner width: 2 border cols + 2 padding cols when boxed; flat rows keep
	// the old prefix arithmetic.
	const headerIconWidth = timeline ? 2 : 0;
	const innerWidth = asCard ? Math.max(12, caps.width - 4) : caps.width;
	const flatLinePrefixWidth = !asCard && timeline ? 4 : 0;

	// visualWidth, not .length: CJK suffix tags (失败/已拒绝) are 2 cols/char —
	// char-count math lets the header overflow and hard-clips the tag glyph.
	const suffixWidth = getTerminalStringWidth(suffix);
	const maxCmdWidth = Math.max(8, innerWidth - headerIconWidth - 4 - (suffixWidth > 0 ? suffixWidth + 3 : 0));
	const maxLineWidth = Math.max(8, innerWidth - flatLinePrefixWidth - 1);
	const hiddenHintWidth = Math.max(8, innerWidth - flatLinePrefixWidth);
	const hiddenHint = hiddenLines > 0
		? (asCard ? truncateEnd(STR.hiddenLines(hiddenLines), hiddenHintWidth) : fitTerminalLine(STR.hiddenLines(hiddenLines), hiddenHintWidth))
		: '';

	// Status color is the card's identity: scanning border colors answers
	// "which one failed" without reading a single character.
	const cardColor = isRunning
		? theme.status.running
		: model.status === 'denied'
			? theme.status.warning
			: isFailure
				? theme.status.danger
				: theme.status.success;

	const header = (
		<>
			<Box flexDirection="row">
				<Text wrap="truncate">
					{timeline && <ToolTimelinePrefix {...timeline} status={model.status} />}
					<Text dimColor color={theme.tool.shell}>$ </Text>
					<CommandText command={truncateMiddle(firstCommandLine, maxCmdWidth)} />
					{suffix.length > 0 && (
						<Text color={isFailure ? theme.status.danger : theme.text.muted} dimColor={!isFailure}>
							{'  '}{suffix}
						</Text>
					)}
				</Text>
			</Box>
			{commandRows.map((line, index) => (
				<Box key={`cmd-${index}`} flexDirection="row">
					{!asCard && timeline && <ToolTimelineContinuation />}
					<Text wrap="truncate">
						<Text dimColor color={theme.tool.shell}>{'  '}</Text>
						<CommandText command={truncateMiddle(line, maxLineWidth - 2)} />
					</Text>
				</Box>
			))}
			{hiddenCommandRows > 0 && (
				<Box flexDirection="row">
					{!asCard && timeline && <ToolTimelineContinuation />}
					<Text wrap="truncate" dimColor>{`  ${STR.hiddenCommandLines(hiddenCommandRows)}`}</Text>
				</Box>
			)}
		</>
	);

	const body = (
		<>
			{isRunning && preview.length === 0 && (
				<Box flexDirection="row">
					{!asCard && timeline && <ToolTimelineContinuation first />}
					<Text wrap="truncate" dimColor>
						{elapsedSeconds !== undefined && elapsedSeconds >= 10 ? STR.runningSilent(elapsedSeconds) : STR.running}
					</Text>
				</Box>
			)}
			{isFailure && lines.length === 0 && (
				<Box flexDirection="row">
					{!asCard && timeline && <ToolTimelineContinuation first />}
					<Text wrap="truncate" dimColor color={theme.text.muted}>{STR.noOutput}</Text>
				</Box>
			)}
			{hiddenLines > 0 && (
				<Box flexDirection="row">
					{!asCard && timeline && <ToolTimelineContinuation first />}
					<Text wrap="truncate" dimColor>{hiddenHint}</Text>
				</Box>
			)}
			{preview.map((line, index) => (
				<Box key={`out-${index}`} flexDirection="row">
					{!asCard && timeline && (
						<ToolTimelineContinuation first={index === 0 && hiddenLines === 0} />
					)}
					<Text
						wrap="truncate"
						color={line.stream === 'stderr' || isFailure ? theme.status.danger : undefined}
						dimColor={!isFailure}
					>
						{truncateEnd(line.text, maxLineWidth)}
					</Text>
				</Box>
			))}
		</>
	);

	if (asCard) {
		return (
			<Box flexDirection="column" marginY={compact || timeline ? 0 : 1} width="100%">
				<Box
					flexDirection="column"
					borderStyle="round"
					borderColor={cardColor}
					borderDimColor={!isFailure && !isRunning}
					paddingX={1}
				>
					{header}
					{body}
				</Box>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" marginY={compact || timeline ? 0 : 1} width="100%">
			{header}
			{body}
		</Box>
	);
}
