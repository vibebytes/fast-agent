import React from 'react';
import {Box, Text} from 'ink';
import type {ToolDisplayModel} from '../../tools/toolMapping.js';
import type {ToolTimelineProps} from './ToolGroupMessage.js';
import {ToolTimelineContinuation, ToolTimelinePrefix, TOOL_HEADER_PREFIX_WIDTH, TOOL_RESULT_PREFIX_WIDTH} from './ToolTimelineRow.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {fitTerminalLine, truncateMiddle} from '../../theme/semanticTheme.js';
import {useTerminalSize} from '../../hooks/useTerminalSize.js';
import {useOverflowReport} from '../../contexts/OverflowContext.js';
import {STR} from '../../ui/strings.js';

type Props = {model: ToolDisplayModel; compact?: boolean; timeline?: ToolTimelineProps; maxLines?: number};

/**
 * read_file: collapsed = one line with a `→ N 行` result summary (claude-code
 * shows just the count; the content is for the model, not the user). Expanded
 * (Ctrl+O) shows a numbered preview.
 */
export function FileToolMessage({model, compact, timeline, maxLines}: Props) {
	const {theme} = useTheme();
	const {columns, rows: terminalRows} = useTerminalSize();
	const caps = {width: columns, height: terminalRows};
	const path = model.args.path ?? model.args.input ?? model.fields.path ?? model.fields.file ?? '';
	const isFailure = model.status === 'failed' || model.status === 'denied';
	const content = model.output.map(o => o.text.replace(/\r$/, '')).join('\n');
	const lines = content.length === 0 ? [] : content.split('\n');
	const previewBudget = model.expanded ? Math.max(20, maxLines ?? 20) : 0;
	const preview = isFailure ? [] : lines.slice(0, previewBudget);

	const errorReason = isFailure
		? (content || model.summary || '').replace(/\n/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
		: '';
	const summaryText = model.status === 'running'
		? STR.running
		: isFailure
			? errorReason || STR.failedTag
			: lines.length === 0 ? STR.emptyFile : STR.lineCount(lines.length);
	const headerPrefixWidth = timeline ? TOOL_HEADER_PREFIX_WIDTH : 0;
	const linePrefixWidth = timeline ? TOOL_RESULT_PREFIX_WIDTH : 0;
	const maxLineWidth = Math.max(8, caps.width - linePrefixWidth - 9);
	const maxPathWidth = Math.max(8, caps.width - headerPrefixWidth - 16 - summaryText.length);

	const hiddenCount = Math.max(0, lines.length - preview.length);
	// Collapsed read_file intentionally hides content — only surface it in the
	// global Ctrl+O counter when the user has expanded and we still clamp.
	useOverflowReport(`file-${model.id}`, model.expanded ? hiddenCount : 0);
	const hiddenHint = model.expanded && hiddenCount > 0
		? fitTerminalLine(STR.hiddenLines(hiddenCount), Math.max(8, caps.width - linePrefixWidth))
		: '';

	const errorBudget = Math.max(8, caps.width - (timeline ? TOOL_RESULT_PREFIX_WIDTH : 0) - 2);

	return (
		<Box flexDirection="column" marginY={compact || timeline ? 0 : 1} width="100%">
			<Box flexDirection="row" width="100%">
				<Text wrap="truncate">
					{timeline && <ToolTimelinePrefix {...timeline} status={model.status} />}
					<Text color={theme.tool.file}>read_file </Text>
					{path.length > 0 && <Text color={theme.text.primary}>{truncateMiddle(path, maxPathWidth)}</Text>}
					{!isFailure && <Text color={theme.text.accent}> → {summaryText}</Text>}
				</Text>
			</Box>
			{isFailure && errorReason.length > 0 && (
				<Box flexDirection="row" width="100%">
					{timeline && <ToolTimelineContinuation first />}
					<Text wrap="truncate" color={theme.status.danger}>
						{truncateMiddle(errorReason, errorBudget)}
					</Text>
				</Box>
			)}
			{preview.map((line, index) => (
				<Box key={index} flexDirection="row" width="100%">
					{timeline && <ToolTimelineContinuation first={index === 0} />}
					<Text wrap="truncate">
						<Text dimColor>{String(index + 1).padStart(4)} │ </Text>{truncateMiddle(line, maxLineWidth)}
					</Text>
				</Box>
			))}
		{hiddenHint.length > 0 && (
			<Box flexDirection="row" width="100%">
				{timeline && <ToolTimelineContinuation />}
				<Text wrap="truncate" dimColor>{hiddenHint}</Text>
			</Box>
		)}
		</Box>
	);
}
