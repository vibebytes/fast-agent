/**
 * Shared visual grammar for tool rows, borrowing the best of both references:
 *
 * - claude-code: `⏺ Tool(args)` header + `⎿ result` elbow indent. We adopt
 *   the elbow — unlike the old `┌─├─┃` tree it cannot dangle or misalign
 *   when neighbours collapse/expand, because every row is self-contained.
 * - gemini-cli: semantic status colors and a gradient spinner while running.
 *
 * Layout contract (keep widths in sync with linePrefixWidth in renderers):
 *   header  = "✓ "            (2 cols)
 *   result  = "  ⎿ " / "    " (4 cols; elbow only on the first result line)
 */
import React from 'react';
import {Text} from 'ink';
import {SPINNER_FRAMES, useSharedSpinnerFrame} from '../../hooks/useSharedSpinner.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {isScreenReader} from '../../terminal/capabilityManager.js';

type Props = {
	isFirst?: boolean;
	isLast?: boolean;
	status: 'running' | 'success' | 'failed' | 'denied';
};

/** Header prefix width in columns. */
export const TOOL_HEADER_PREFIX_WIDTH = 2;
/** Result-line prefix width in columns. */
export const TOOL_RESULT_PREFIX_WIDTH = 4;

export function ToolTimelinePrefix({status}: Props) {
	const {theme} = useTheme();
	const {frame, index} = useSharedSpinnerFrame(status === 'running');

	const icon = status === 'running'
		? frame
		: status === 'success'
			? '✓'
			: status === 'denied'
				? '⊘'
				: '✗';
	const iconColor = status === 'running'
		? theme.spinner[index % theme.spinner.length] ?? theme.status.running
		: status === 'success'
			? theme.status.success
			: status === 'denied'
				? theme.status.warning
				: theme.status.danger;

	return (
		<Text>
			<Text color={iconColor}>{isScreenReader() ? statusWord(status) : icon}</Text>{' '}
		</Text>
	);
}

function statusWord(status: Props['status']): string {
	switch (status) {
		case 'running': return '…';
		case 'success': return 'ok';
		case 'denied': return '!';
		default: return 'x';
	}
}

/**
 * Result-line indent. The first result line of a tool gets the elbow `⎿`,
 * continuation lines get plain alignment spaces.
 */
export function ToolTimelineContinuation({first = false}: {first?: boolean}) {
	if (isScreenReader()) return <Text>{'    '}</Text>;
	return <Text dimColor>{first ? '  ⎿ ' : '    '}</Text>;
}

export {SPINNER_FRAMES as FRAMES};
