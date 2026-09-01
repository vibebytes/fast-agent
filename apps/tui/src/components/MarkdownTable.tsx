import React from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../contexts/ThemeContext.js';
import {padToWidth, truncateEnd, visualWidth} from '../utils/textWidth.js';

export type MarkdownTableData = {
	headers: string[];
	rows: string[][];
};

export function parseMarkdownTable(lines: string[]): MarkdownTableData | undefined {
	if (lines.length < 2) return undefined;
	const headerLine = lines[0];
	const separatorLine = lines[1];
	if (!headerLine?.includes('|') || !separatorLine?.match(/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/)) {
		return undefined;
	}

	const splitRow = (line: string): string[] =>
		line
			.trim()
			.replace(/^\|/, '')
			.replace(/\|$/, '')
			.split('|')
			.map(cell => cell.trim());

	// Rows are the CONTIGUOUS run of `|` lines after the separator. The old
	// filter() swallowed any later line containing `|` (prose, shell pipes)
	// into the table and desynced the caller's consumed-line count.
	const rows: string[][] = [];
	for (const line of lines.slice(2)) {
		if (!line.includes('|')) break;
		rows.push(splitRow(line));
	}

	return {
		headers: splitRow(headerLine),
		rows
	};
}

type Props = {
	table: MarkdownTableData;
	compact?: boolean;
	/** Terminal columns available for the table (including separators). */
	availableWidth?: number;
};

const MIN_COLUMN_WIDTH = 3;
const SEPARATOR = ' │ ';

/**
 * Width-accurate table renderer. All measurements use visual column width
 * (string-width), so CJK/emoji cells align exactly; columns shrink
 * proportionally on narrow terminals (gemini-cli style min/max distribution).
 */
export function MarkdownTable({table, compact, availableWidth = 80}: Props) {
	const {theme} = useTheme();
	const columnCount = Math.max(table.headers.length, ...table.rows.map(row => row.length), 1);
	const widths = computeColumnWidths(table, columnCount, availableWidth);

	const formatRow = (cells: string[]) =>
		widths
			.map((width, columnIndex) => padToWidth(truncateEnd(cells[columnIndex] ?? '', width), width))
			.join(SEPARATOR);

	const headerRow = formatRow(table.headers);
	const visibleRows = compact ? table.rows.slice(0, 5) : table.rows;

	return (
		<Box flexDirection="column" marginY={compact ? 0 : 1} width="100%">
			<Text bold color={theme.text.accent}>{headerRow}</Text>
			<Text dimColor>{'─'.repeat(Math.min(availableWidth, visualWidth(headerRow)))}</Text>
			{visibleRows.map((row, index) => (
				<Text key={index}>{formatRow(row)}</Text>
			))}
			{compact && table.rows.length > visibleRows.length && (
				<Text dimColor>… {table.rows.length - visibleRows.length} more rows</Text>
			)}
		</Box>
	);
}

export function computeColumnWidths(table: MarkdownTableData, columnCount: number, availableWidth: number): number[] {
	const desired = Array.from({length: columnCount}, (_, columnIndex) => {
		const cells = [
			table.headers[columnIndex] ?? '',
			...table.rows.map(row => row[columnIndex] ?? '')
		];
		return Math.max(MIN_COLUMN_WIDTH, ...cells.map(cell => visualWidth(cell)));
	});

	const separatorTotal = SEPARATOR.length * Math.max(0, columnCount - 1);
	const budget = Math.max(columnCount * MIN_COLUMN_WIDTH, availableWidth - separatorTotal);
	const desiredTotal = desired.reduce((sum, width) => sum + width, 0);
	if (desiredTotal <= budget) {
		return desired;
	}

	// Shrink the widest columns first until the table fits.
	const widths = [...desired];
	let overflow = desiredTotal - budget;
	while (overflow > 0) {
		let widestIndex = 0;
		for (let index = 1; index < widths.length; index++) {
			if (widths[index]! > widths[widestIndex]!) widestIndex = index;
		}
		if (widths[widestIndex]! <= MIN_COLUMN_WIDTH) break;
		widths[widestIndex] = widths[widestIndex]! - 1;
		overflow -= 1;
	}
	return widths;
}
