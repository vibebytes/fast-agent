import React, {useId, useMemo} from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../contexts/ThemeContext.js';
import {useOverflowReport} from '../contexts/OverflowContext.js';
import {STR} from '../ui/strings.js';
import {highlightCode} from '../utils/syntaxHighlight.js';
import {SmoothText} from './SmoothText.js';
import {MarkdownTable, parseMarkdownTable} from './MarkdownTable.js';
import {useTerminalSize} from '../hooks/useTerminalSize.js';
import {countWrappedLines, tailLines} from '../utils/textWidth.js';

type ListItem = {marker: string; content: string; indent: number};

type Block =
	| {kind: 'text'; content: string}
	| {kind: 'heading'; level: number; content: string}
	| {kind: 'hr'}
	| {kind: 'code'; language: string; content: string; closed: boolean}
	| {kind: 'quote'; content: string}
	| {kind: 'list'; items: ListItem[]}
	| {kind: 'table'; headers: string[]; rows: string[][]};

const FENCE_OPEN = /^```(.*)$/;
const FENCE_CLOSE = /^```\s*$/;
const HEADING = /^ *(#{1,6}) +(.*)$/;
const HR = /^ *([-*_] *){3,} *$/;
const LIST_PATTERN = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;
/** Indented non-marker line — the wrapped tail of the previous list item. */
const LIST_CONTINUATION = /^\s+\S/;

/**
 * Single-pass line state machine (replaces the old regex-over-whole-text
 * parser, which re-scanned the entire accumulated stream per delta and
 * probed every prose line with the table parser — O(n²)).
 *
 * Fences open at a `^```info` line (any info string: c++, c#, objective-c)
 * and close only at a bare `^```` line, so backticks inside code never
 * terminate the block early.
 */
function parseBlocks(text: string): Block[] {
	const lines = text.split('\n');
	const blocks: Block[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index]!;

		const fence = line.match(FENCE_OPEN);
		if (fence) {
			const content: string[] = [];
			let closed = false;
			index += 1;
			while (index < lines.length) {
				if (FENCE_CLOSE.test(lines[index]!)) {
					closed = true;
					index += 1;
					break;
				}
				content.push(lines[index]!);
				index += 1;
			}
			// Streaming: drop the half-typed trailing empty line so the code
			// box does not grow a phantom row per delta.
			if (!closed && content.at(-1) === '') content.pop();
			blocks.push({
				kind: 'code',
				language: (fence[1] ?? '').trim().split(/\s+/)[0] ?? '',
				content: content.join('\n'),
				closed
			});
			continue;
		}

		const heading = line.match(HEADING);
		if (heading) {
			blocks.push({kind: 'heading', level: heading[1]?.length ?? 1, content: heading[2] ?? ''});
			index += 1;
			continue;
		}

		if (HR.test(line)) {
			blocks.push({kind: 'hr'});
			index += 1;
			continue;
		}

		if (line.startsWith('> ') || line === '>') {
			const quoteLines: string[] = [];
			while (index < lines.length) {
				const current = lines[index]!;
				if (current === '>') {
					quoteLines.push('');
				} else if (current.startsWith('> ')) {
					quoteLines.push(current.slice(2));
				} else {
					break;
				}
				index += 1;
			}
			blocks.push({kind: 'quote', content: quoteLines.join('\n')});
			continue;
		}

		// Cheap `|` pre-check before invoking the full table parser.
		if (line.includes('|')) {
			const tableLines = lines.slice(index);
			const table = parseMarkdownTable(tableLines);
			if (table && tableLines.length >= 2) {
				blocks.push({kind: 'table', headers: table.headers, rows: table.rows});
				index += Math.min(tableLines.length, 2 + table.rows.length);
				continue;
			}
		}

		if (LIST_PATTERN.test(line)) {
			const items: ListItem[] = [];
			while (index < lines.length) {
				const current = lines[index]!;
				const itemMatch = current.match(LIST_PATTERN);
				if (itemMatch) {
					items.push({
						indent: Math.floor((itemMatch[1] ?? '').length / 2),
						marker: /^\d/.test(itemMatch[2] ?? '') ? `${itemMatch[2]}` : '•',
						content: itemMatch[3] ?? ''
					});
					index += 1;
					continue;
				}
				// Wrapped list items: LLMs often continue a long bullet on the
				// next (indented) line — fold it into the previous item.
				if (LIST_CONTINUATION.test(current) && !HEADING.test(current) && !HR.test(current)) {
					items[items.length - 1]!.content += ` ${current.trim()}`;
					index += 1;
					continue;
				}
				break;
			}
			blocks.push({kind: 'list', items});
			continue;
		}

		// Paragraph: accumulate until the next structural line. The entry
		// checks above guarantee at least one line is consumed here.
		const buffer: string[] = [];
		while (index < lines.length) {
			const current = lines[index]!;
			if (
				buffer.length > 0
				&& (FENCE_OPEN.test(current)
					|| current.startsWith('> ')
					|| current === '>'
					|| HEADING.test(current)
					|| HR.test(current)
					|| LIST_PATTERN.test(current)
					|| (current.includes('|') && Boolean(parseMarkdownTable(lines.slice(index)))))
			) {
				break;
			}
			buffer.push(current);
			index += 1;
		}
		const content = buffer.join('\n');
		if (content.trim().length > 0) {
			blocks.push({kind: 'text', content});
		}
	}

	return blocks.length > 0 ? blocks : [{kind: 'text', content: text}];
}

export type MarkdownClamp = {
	/** 'tail' keeps the newest rows (streaming live region). */
	mode: 'tail';
	maxLines: number;
};

type Props = {
	text: string;
	compact?: boolean;
	streaming?: boolean;
	/**
	 * Optional row budget. Settled (scrollback) content renders in full and
	 * must NOT pass a clamp; only the live region is constrained so a frame
	 * can never exceed the terminal height.
	 */
	clamp?: MarkdownClamp;
};

export function MarkdownContent({text, compact, streaming, clamp}: Props) {
	const {columns} = useTerminalSize();
	const overflowId = useId();
	const contentWidth = Math.max(20, columns - 4);
	// Memoized: streaming used to re-parse the whole accumulated text on
	// every delta AND every unrelated re-render.
	const parsed = useMemo(() => parseBlocks(text), [text]);
	let blocks = parsed;
	let hiddenLines = 0;

	if (clamp) {
		({blocks, hiddenLines} = clampBlocksTail(blocks, clamp.maxLines, contentWidth));
	}
	useOverflowReport(`md-${overflowId}`, hiddenLines);

	return (
		<Box flexDirection="column" width="100%">
			{hiddenLines > 0 && (
				<Text dimColor>{STR.alreadyPrinted(hiddenLines)}</Text>
			)}
			{blocks.map((block, index) => (
				<MarkdownBlock
					key={`block-${index}`}
					block={block}
					compact={compact}
					streaming={streaming === true && index === blocks.length - 1}
					contentWidth={contentWidth}
				/>
			))}
		</Box>
	);
}

function MarkdownBlock({block, compact, streaming, contentWidth}: {
	block: Block;
	compact?: boolean;
	streaming: boolean;
	contentWidth: number;
}) {
	const {theme} = useTheme();
	const marginY = compact ? 0 : undefined;

	switch (block.kind) {
		case 'heading': {
			// Color tiers distinguish levels without printing `#` literals:
			// h1 accent+underline, h2 accent, h3 primary, h4+ secondary.
			const color = block.level <= 2
				? theme.text.accent
				: block.level === 3
					? theme.text.primary
					: theme.text.secondary;
			return (
				<Box flexDirection="row" width="100%" marginTop={marginY ?? (block.level <= 2 ? 1 : 0)}>
					<Text bold color={color} underline={block.level === 1} wrap="wrap">
						{block.content}
					</Text>
				</Box>
			);
		}
		case 'hr':
			return (
				<Box flexDirection="row" width="100%">
					<Text dimColor>{'─'.repeat(Math.min(40, contentWidth))}</Text>
				</Box>
			);
		case 'code':
			return (
				<Box flexDirection="column" marginY={marginY ?? 1} paddingLeft={1} width="100%">
					<Text dimColor color={theme.text.muted}>
						{block.language || 'code'}{block.closed ? '' : ` · ${STR.codeGenerating}`}
					</Text>
					<Box
						flexDirection="column"
						borderStyle="single"
						borderLeft
						borderRight={false}
						borderTop={false}
						borderBottom={false}
						borderColor={theme.border.panel}
						paddingLeft={1}
						width="100%"
					>
						{block.content.split('\n').map((line, lineIndex) => (
							<React.Fragment key={lineIndex}>
								{highlightCode(line, block.language, theme)}
							</React.Fragment>
						))}
					</Box>
				</Box>
			);
		case 'quote':
			return (
				<Box
					flexDirection="column"
					marginY={marginY ?? 1}
					paddingLeft={1}
					borderStyle="single"
					borderLeft
					borderRight={false}
					borderTop={false}
					borderBottom={false}
					borderColor={theme.text.muted}
					width="100%"
				>
					{block.content.split('\n').map((line, lineIndex) => (
						<Text key={lineIndex} dimColor italic color={theme.text.secondary} wrap="wrap">{line}</Text>
					))}
				</Box>
			);
		case 'list':
			return (
				<Box flexDirection="column" marginY={marginY ?? 0} width="100%">
					{block.items.map((item, itemIndex) => (
						<Box key={itemIndex} flexDirection="row" width="100%" paddingLeft={item.indent * 2}>
							<Text wrap="wrap">
								<Text color={theme.text.accent}>{item.marker} </Text>
								{streaming && itemIndex === block.items.length - 1
									? <SmoothText text={item.content} active />
									: <RenderInline text={item.content} />}
							</Text>
						</Box>
					))}
				</Box>
			);
		case 'table':
			return (
				<MarkdownTable
					compact={compact}
					table={{headers: block.headers, rows: block.rows}}
					availableWidth={contentWidth}
				/>
			);
		default:
			return streaming ? (
				<Box width="100%">
					<SmoothText text={block.content} active />
				</Box>
			) : (
				<Box flexDirection="row" width="100%">
					<Text wrap="wrap">
						<RenderInline text={block.content} />
					</Text>
				</Box>
			);
	}
}

/**
 * Keep only the newest blocks that fit `maxLines` rows; if the newest block
 * alone exceeds the budget, keep its last rows. Estimation is CJK-accurate
 * via string-width so a streaming frame can never exceed the viewport.
 */
function clampBlocksTail(blocks: Block[], maxLines: number, width: number): {blocks: Block[]; hiddenLines: number} {
	const kept: Block[] = [];
	let used = 0;
	let hiddenLines = 0;

	for (let index = blocks.length - 1; index >= 0; index--) {
		const block = blocks[index]!;
		const cost = estimateBlockLines(block, width);
		if (used + cost <= maxLines) {
			kept.unshift(block);
			used += cost;
			continue;
		}
		const remaining = maxLines - used;
		if (kept.length === 0 && remaining > 1 && (block.kind === 'text' || block.kind === 'code')) {
			// The newest block alone is too tall: keep its tail rows.
			const reserve = block.kind === 'code' ? 2 : 0;
			const sliced = tailLines(block.content, Math.max(1, remaining - reserve), width);
			kept.unshift(block.kind === 'code'
				? {...block, content: sliced.text}
				: {kind: 'text', content: sliced.text});
			hiddenLines += sliced.hiddenLines;
			used = maxLines;
		} else {
			hiddenLines += cost;
		}
		// Everything older than the first non-fitting block is hidden.
		for (let rest = index - 1; rest >= 0; rest--) {
			hiddenLines += estimateBlockLines(blocks[rest]!, width);
		}
		break;
	}

	return {blocks: kept, hiddenLines};
}

function estimateBlockLines(block: Block, width: number): number {
	switch (block.kind) {
		case 'heading':
			return countWrappedLines(block.content, width);
		case 'hr':
			return 1;
		case 'quote':
			return countWrappedLines(block.content, Math.max(10, width - 2));
		case 'code':
			// Long code lines wrap in the terminal; counting logical lines
			// under-budgeted the clamp and let live frames exceed the viewport.
			return countWrappedLines(block.content, Math.max(10, width - 3)) + 1;
		case 'list':
			return block.items.reduce(
				(sum, item) => sum + countWrappedLines(item.content, Math.max(10, width - 2 - item.indent * 2)),
				0
			);
		case 'table':
			return block.rows.length + 2;
		default:
			return countWrappedLines(block.content, width);
	}
}

export type InlineToken =
	| {kind: 'text' | 'code' | 'bold' | 'italic' | 'strike'; content: string}
	| {kind: 'link'; content: string; url: string};

/**
 * Single-pass inline scanner (replaces the old alternation-split regex,
 * which italicized `2*3*4`, truncated URLs containing `)` and shattered
 * bold spans around nested backticks).
 */
export function parseInline(text: string): InlineToken[] {
	const tokens: InlineToken[] = [];
	let plain = '';
	let index = 0;
	const flush = () => {
		if (plain.length > 0) {
			tokens.push({kind: 'text', content: plain});
			plain = '';
		}
	};

	while (index < text.length) {
		const ch = text[index]!;

		if (ch === '`') {
			const end = text.indexOf('`', index + 1);
			if (end > index + 1) {
				flush();
				tokens.push({kind: 'code', content: text.slice(index + 1, end)});
				index = end + 1;
				continue;
			}
		}

		if (text.startsWith('**', index)) {
			const end = text.indexOf('**', index + 2);
			if (end > index + 1) {
				flush();
				tokens.push({kind: 'bold', content: text.slice(index + 2, end)});
				index = end + 2;
				continue;
			}
		}

		if (text.startsWith('~~', index)) {
			const end = text.indexOf('~~', index + 2);
			if (end > index + 1) {
				flush();
				tokens.push({kind: 'strike', content: text.slice(index + 2, end)});
				index = end + 2;
				continue;
			}
		}

		if (ch === '*') {
			// Left-flanking only: `2*3*4` must not italicize, `*word*` must.
			const prev = index > 0 ? text[index - 1]! : '';
			const next = text[index + 1];
			if (!/\w/.test(prev) && next !== undefined && next !== ' ' && next !== '*') {
				const end = text.indexOf('*', index + 1);
				if (end > index + 1 && text[end - 1] !== ' ') {
					flush();
					tokens.push({kind: 'italic', content: text.slice(index + 1, end)});
					index = end + 1;
					continue;
				}
			}
		}

		if (ch === '[') {
			const closeBracket = text.indexOf(']', index + 1);
			if (closeBracket > index && text[closeBracket + 1] === '(') {
				// Paren balancing keeps Wikipedia-style URLs like .../Foo_(bar) intact.
				let depth = 1;
				let cursor = closeBracket + 2;
				while (cursor < text.length && depth > 0) {
					if (text[cursor] === '(') depth += 1;
					else if (text[cursor] === ')') depth -= 1;
					cursor += 1;
				}
				if (depth === 0) {
					flush();
					tokens.push({
						kind: 'link',
						content: text.slice(index + 1, closeBracket),
						url: text.slice(closeBracket + 2, cursor - 1)
					});
					index = cursor;
					continue;
				}
			}
		}

		plain += ch;
		index += 1;
	}

	flush();
	return tokens;
}

function RenderInline({text}: {text: string}) {
	const {theme} = useTheme();
	const tokens = parseInline(text);
	return (
		<>
			{tokens.map((token, index) => {
				switch (token.kind) {
					case 'code':
						return <Text key={index} color={theme.status.warning}>{token.content}</Text>;
					case 'bold':
						return <Text key={index} bold>{token.content}</Text>;
					case 'strike':
						return <Text key={index} strikethrough dimColor>{token.content}</Text>;
					case 'italic':
						return <Text key={index} italic>{token.content}</Text>;
					case 'link':
						// Terminals cannot click through — keep the target visible
						// unless the link text already IS the URL.
						return (
							<Text key={index}>
								<Text color={theme.text.accent} underline>{token.content}</Text>
								{token.url !== token.content && <Text dimColor> ({token.url})</Text>}
							</Text>
						);
					default:
						return <Text key={index}>{token.content}</Text>;
				}
			})}
		</>
	);
}

export {parseBlocks};
