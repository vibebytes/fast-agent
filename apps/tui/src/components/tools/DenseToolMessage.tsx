import React from 'react';
import {Box, Text} from 'ink';
import type {ToolDisplayModel, GrepMatch} from '../../tools/toolMapping.js';
import {globMatches, grepMatches} from '../../tools/toolMapping.js';
import type {ToolTimelineProps} from './ToolGroupMessage.js';
import {ToolTimelinePrefix, ToolTimelineContinuation, TOOL_HEADER_PREFIX_WIDTH, TOOL_RESULT_PREFIX_WIDTH} from './ToolTimelineRow.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {truncateMiddle} from '../../theme/semanticTheme.js';
import {useTerminalSize} from '../../hooks/useTerminalSize.js';
import {STR} from '../../ui/strings.js';

type Props = {model: ToolDisplayModel; compact?: boolean; timeline?: ToolTimelineProps};

/** Collapsed glob bodies list this many matches before folding behind Ctrl+O. */
const GLOB_LIST_LIMIT = 3;

/** Args worth showing inline, in priority order (gemini-cli's description slot). */
const PRIMARY_ARG_KEYS = ['path', 'file', 'file_path', 'pattern', 'query', 'glob_pattern', 'name', 'url', 'input'];

/** Search tools: the pattern IS the story — `glob **∕*.tsx`, never `glob .`
 * (the path arg is usually just "." and hides what was searched for). */
const SEARCH_ARG_KEYS = ['pattern', 'glob_pattern', 'query', 'path', 'file', 'file_path', 'name', 'url', 'input'];
const SEARCH_TOOLS = new Set(['glob', 'grep']);

/**
 * One-line tool row: `✓ grep "foo" → 12 matches`. Status icon carries the
 * outcome (no uppercase SUCCESS noise); the accent arrow carries the result
 * summary; failures swap the arrow text to the error in red.
 */
export function DenseToolMessage({model, compact, timeline}: Props) {
	const {theme} = useTheme();
	// useTerminalSize (not a one-shot capability read) so resize re-renders.
	const {columns} = useTerminalSize();
	const headerPrefixWidth = timeline ? TOOL_HEADER_PREFIX_WIDTH : 0;
	const contentWidth = Math.max(8, columns - headerPrefixWidth);

	const argKeys = SEARCH_TOOLS.has(model.tool) ? SEARCH_ARG_KEYS : PRIMARY_ARG_KEYS;
	const primaryArg = argKeys.map(key => model.args[key]).find(value => value && value.length > 0);
	const isFailure = model.status === 'failed' || model.status === 'denied';
	const resultText = model.status === 'running'
		? undefined
		: model.status === 'denied'
			? STR.deniedTag
			: model.summary.replace(/\n/g, ' ').trim();

	const argBudget = Math.max(8, Math.floor(contentWidth * 0.4));
	const summaryBudget = Math.max(8, contentWidth - model.tool.length - (primaryArg ? Math.min(primaryArg.length, argBudget) : 0) - 6);

	// Multi-match tool results: the header carries the count, the matches
	// render as an elbow-indented list (claude-code result grammar). Compact
	// aggregate views stay single-line.
	const globFileList = compact ? [] : globMatches(model);
	const visibleGlobFiles = model.expanded ? globFileList : globFileList.slice(0, GLOB_LIST_LIMIT);
	const hiddenGlobFiles = globFileList.length - visibleGlobFiles.length;

	const grepMatchList = compact ? [] : grepMatches(model);
	const visibleGrepMatches = model.expanded ? grepMatchList : grepMatchList.slice(0, GLOB_LIST_LIMIT);
	const hiddenGrepMatches = grepMatchList.length - visibleGrepMatches.length;

	const lineBudget = Math.max(8, contentWidth - TOOL_RESULT_PREFIX_WIDTH - 1);

	return (
		<Box flexDirection="column" marginY={compact || timeline ? 0 : 1} width="100%">
			<Box flexDirection="row" width="100%">
				<Text wrap="truncate">
					{timeline && <ToolTimelinePrefix {...timeline} status={model.status} />}
					<Text color={theme.text.accent}>{model.tool}</Text>
					{primaryArg && <Text color={theme.text.primary}> {truncateMiddle(primaryArg, argBudget)}</Text>}
					{resultText && resultText.length > 0 && (
						<Text color={isFailure ? theme.status.danger : theme.text.accent}>
							{' → '}{truncateMiddle(resultText, summaryBudget)}
						</Text>
					)}
					{model.duration && <Text dimColor> · {model.duration}</Text>}
				</Text>
			</Box>
			{/* Glob match list */}
			{visibleGlobFiles.map((file, index) => (
				<Box key={`glob-${file}-${index}`} flexDirection="row">
					<ToolTimelineContinuation first={index === 0} />
					<Text dimColor wrap="truncate">{truncateMiddle(file, lineBudget)}</Text>
				</Box>
			))}
			{hiddenGlobFiles > 0 && (
				<Box flexDirection="row">
					<ToolTimelineContinuation />
					<Text dimColor wrap="truncate">{STR.hiddenFiles(hiddenGlobFiles)}</Text>
				</Box>
			)}
			{/* Grep match list — shows file:line: content */}
			{visibleGrepMatches.map((match, index) => (
				<Box key={`grep-${match.file}:${match.line}`} flexDirection="row">
					<ToolTimelineContinuation first={index === 0} />
					<Text dimColor wrap="truncate">
						{match.file}:{match.line}: <Text color={theme.text.primary}>{match.content}</Text>
					</Text>
				</Box>
			))}
			{hiddenGrepMatches > 0 && (
				<Box flexDirection="row">
					<ToolTimelineContinuation />
					<Text dimColor wrap="truncate">{STR.hiddenFiles(hiddenGrepMatches)}</Text>
				</Box>
			)}
		</Box>
	);
}
