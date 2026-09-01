import React from 'react';
import {Box, Text} from 'ink';
import type {ToolDisplayModel} from '../../tools/toolMapping.js';
import type {ToolTimelineProps} from './ToolGroupMessage.js';
import {ToolTimelineContinuation, ToolTimelinePrefix, TOOL_HEADER_PREFIX_WIDTH, TOOL_RESULT_PREFIX_WIDTH} from './ToolTimelineRow.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useOverflowReport} from '../../contexts/OverflowContext.js';
import {fitTerminalLine, truncateMiddle} from '../../theme/semanticTheme.js';
import type {SemanticTheme} from '../../theme/semanticTheme.js';
import {useTerminalSize} from '../../hooks/useTerminalSize.js';
import {STR} from '../../ui/strings.js';

type Props = {model: ToolDisplayModel; compact?: boolean; timeline?: ToolTimelineProps; maxLines?: number};
type DiffLine =
	| {type: 'add'; newLine: number; content: string}
	| {type: 'del'; oldLine: number; content: string}
	| {type: 'context'; oldLine: number; newLine: number; content: string}
	| {type: 'hunk'; content: string}
	| {type: 'other'; content: string};

export function DiffToolMessage({model, compact, timeline, maxLines}: Props) {
	const {theme} = useTheme();
	const {columns, rows: terminalRows} = useTerminalSize();
	const caps = {width: columns, height: terminalRows};
	const path = model.args.path ?? model.args.file_path ?? model.args.file ?? 'file';
	const content = model.output.length > 0
		? model.output.map(output => output.text.replace(/\r$/, '')).join('\n')
		: (model.fields?.output ?? model.fields?.message ?? '');
	const lines = content.length === 0 ? [] : content.split('\n');
	const headline = model.tool === 'git.diff'
		? lines.find(l => l.startsWith('diff --git')) ?? fallbackHeadline(model.tool, model.args.args ?? '')
		: (lines[0] ?? fallbackHeadline(model.tool, path));
	const parsed = parseDiffWithLineNumbers(lines.slice(1).join('\n'));
	const displayLines = parsed.filter(line => line.type !== 'other');
	const budget = model.expanded
		? Math.max(24, maxLines ?? 24)
		: compact
			? 4
			: 9; // Show up to 9 lines when not expanded, to reveal actual changes
	const preview = diffPreview(displayLines, budget);
	const hidden = Math.max(0, displayLines.length - preview.length);
	useOverflowReport(`diff-${model.id}`, hidden);
	const added = displayLines.filter(line => line.type === 'add').length;
	const removed = displayLines.filter(line => line.type === 'del').length;
	const gutterWidth = Math.max(1, ...displayLines.map(lineNumber).map(value => String(value ?? '').length));
	const headerPrefixWidth = timeline ? TOOL_HEADER_PREFIX_WIDTH : 0;
	const linePrefixWidth = timeline ? TOOL_RESULT_PREFIX_WIDTH : 0;
	const maxLineWidth = Math.max(8, caps.width - linePrefixWidth - gutterWidth - 4);
	const maxPathWidth = Math.max(8, caps.width - headerPrefixWidth - 24);
	const fixedHintWidth = Math.max(8, caps.width - linePrefixWidth);
	const hiddenHint = hidden > 0
		? fitTerminalLine(STR.hiddenLines(hidden), fixedHintWidth)
		: '';
	// Skip the dim headline when it adds nothing over header + diff stats.
	const showHeadline = headline.trim().length > 0 && displayLines.length === 0;

	return (
		<Box flexDirection="column" marginY={compact || timeline ? 0 : 1} width="100%">
			<Box flexDirection="row" width="100%">
				<Text wrap="truncate">
					{timeline && <ToolTimelinePrefix {...timeline} status={model.status} />}
					<Text color={theme.tool.file}>{labelFor(model.tool)} </Text>
					<Text color={theme.text.primary}>{truncateMiddle(path, maxPathWidth)}</Text>
					{(added > 0 || removed > 0) && (
						<Text>
							{' ('}
							<Text color={theme.status.success}>+{added}</Text>
							{' '}
							<Text color={theme.status.danger}>-{removed}</Text>
							{')'}
						</Text>
					)}
					{model.duration && <Text dimColor> · {model.duration}</Text>}
				</Text>
			</Box>
			{showHeadline && (
				<Box flexDirection="row" width="100%">
					{timeline && <ToolTimelineContinuation first />}
					<Text wrap="truncate" dimColor>{headline}</Text>
				</Box>
			)}
			{preview.map((line, index) => (
				<Box key={`${model.id}-diff-${index}`} flexDirection="row" width="100%">
					{timeline && <ToolTimelineContinuation first={index === 0 && !showHeadline} />}
					{renderDiffLine(line, gutterWidth, theme, maxLineWidth)}
				</Box>
			))}
		{hidden > 0 && (
			<Box flexDirection="row" width="100%">
				{timeline && <ToolTimelineContinuation />}
				<Text wrap="truncate" dimColor>{hiddenHint}</Text>
			</Box>
		)}
		</Box>
	);
}

/**
 * Window a parsed diff so the first add/del stays visible within `budget`.
 * Keeps the nearest preceding hunk header when possible, but skips leading
 * context that would push the actual change outside the window.
 */
export function diffPreview(lines: DiffLine[], budget: number): DiffLine[] {
	if (budget <= 0 || lines.length === 0) return [];
	if (lines.length <= budget) return lines;
	const firstChangeIdx = lines.findIndex(line => line.type === 'add' || line.type === 'del');
	if (firstChangeIdx < 0) return lines.slice(0, budget);
	// Already visible in a head slice — keep natural top-of-diff context.
	if (firstChangeIdx < budget) return lines.slice(0, budget);

	let hunkIdx = -1;
	for (let i = firstChangeIdx - 1; i >= 0; i--) {
		if (lines[i]!.type === 'hunk') {
			hunkIdx = i;
			break;
		}
	}
	// Hunk + body still fits: start at hunk (includes some leading context).
	if (hunkIdx >= 0 && firstChangeIdx - hunkIdx < budget)
		return lines.slice(hunkIdx, hunkIdx + budget);
	// Leading context would eat the whole budget — keep hunk, then jump to changes.
	if (hunkIdx >= 0 && budget >= 2)
		return [lines[hunkIdx]!, ...lines.slice(firstChangeIdx, firstChangeIdx + budget - 1)];
	return lines.slice(firstChangeIdx, firstChangeIdx + budget);
}

export function parseDiffWithLineNumbers(diffContent: string): DiffLine[] {
	const result: DiffLine[] = [];
	let oldLine = 0;
	let newLine = 0;
	let inHunk = false;
	const hunkHeader = /^@@ -(\d+),?\d* \+(\d+),?\d* @@/;

	for (const line of diffContent.split(/\r?\n/)) {
		const match = line.match(hunkHeader);
		if (match) {
			oldLine = Number.parseInt(match[1] ?? '1', 10) - 1;
			newLine = Number.parseInt(match[2] ?? '1', 10) - 1;
			inHunk = true;
			result.push({type: 'hunk', content: line});
			continue;
		}
		if (!inHunk) {
			if (!line.startsWith('--- ') && !line.startsWith('+++ ') && line.trim().length > 0) {
				result.push({type: 'other', content: line});
			}
			continue;
		}
		if (line.startsWith('+')) {
			newLine += 1;
			result.push({type: 'add', newLine, content: line.slice(1)});
		} else if (line.startsWith('-')) {
			oldLine += 1;
			result.push({type: 'del', oldLine, content: line.slice(1)});
		} else if (line.startsWith(' ')) {
			oldLine += 1;
			newLine += 1;
			result.push({type: 'context', oldLine, newLine, content: line.slice(1)});
		}
	}

	return result;
}

function renderDiffLine(line: DiffLine, gutterWidth: number, theme: SemanticTheme, maxLineWidth: number): React.ReactNode {
	if (line.type === 'hunk') {
		return <Text dimColor>{line.content}</Text>;
	}
	if (line.type === 'other') {
		return <Text dimColor>{line.content}</Text>;
	}

	const number = lineNumber(line);
	const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
	// Soft truecolor backgrounds with normal-contrast foregrounds; themes
	// without diff backgrounds (ansi/no-color) degrade to prefix-only colors.
	const bg = line.type === 'add' ? theme.diff.addedBg : line.type === 'del' ? theme.diff.removedBg : undefined;
	const fg = line.type === 'add' ? theme.diff.addedFg : line.type === 'del' ? theme.diff.removedFg : theme.text.primary;

	return (
		<>
			<Box width={gutterWidth + 1} justifyContent="flex-end" flexShrink={0} backgroundColor={bg} userSelect="none">
				<Text dimColor color={theme.text.secondary}>{String(number ?? '').padStart(gutterWidth)} </Text>
			</Box>
			<Text backgroundColor={bg} color={fg} wrap="truncate">
				<Text color={fg}>{prefix} </Text>
				{truncateMiddle(line.content.replace(/\t/g, '    '), maxLineWidth)}
			</Text>
		</>
	);
}

function lineNumber(line: DiffLine): number | undefined {
	switch (line.type) {
		case 'add':
			return line.newLine;
		case 'del':
			return line.oldLine;
		case 'context':
			return line.newLine;
		default:
			return undefined;
	}
}

function labelFor(tool: string): string {
	if (tool === 'edit_file') return 'Edit';
	if (tool === 'git.diff') return 'Diff';
	return 'Write';
}

function fallbackHeadline(tool: string, path: string): string {
	if (tool === 'edit_file') return `Edited ${path}`;
	if (tool === 'git.diff') return `Git diff ${path}`;
	return `Wrote ${path}`;
}
