import React from 'react';
import {Text} from 'ink';
import type {SemanticTheme} from '../theme/semanticTheme.js';

const keywords = new Set([
	'import',
	'from',
	'def',
	'class',
	'object',
	'case',
	'val',
	'var',
	'if',
	'else',
	'for',
	'while',
	'return',
	'try',
	'catch',
	'extends',
	'true',
	'false',
	'None',
	'Some',
	'Future'
]);

/** Same-quote pairs only — `'a"` must not be treated as a string literal. */
const STRING_RE = /^("[^"]*"|'[^']*'|`[^`]*`)$/;

/**
 * Lightweight line highlighter for code blocks. Colors come from the
 * semantic theme (raw ANSI names were unreadable on light backgrounds and
 * ignored the no-color theme).
 */
export function highlightCode(line: string, _language: string, theme: SemanticTheme): React.ReactNode {
	if (theme.noColor) {
		return <Text>{line}</Text>;
	}
	const trimmed = line.trimStart();
	if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
		return <Text color={theme.status.success}>{line}</Text>;
	}

	const parts = line.split(/("[^"]*"|'[^']*'|`[^`]*`|\b\w+\b)/g);
	return (
		<Text>
			{parts.map((part, index) => {
				if (STRING_RE.test(part)) {
					return <Text key={index} color={theme.status.warning}>{part}</Text>;
				}
				if (/^\d+$/.test(part)) {
					return <Text key={index} color={theme.status.info}>{part}</Text>;
				}
				return keywords.has(part)
					? <Text key={index} color={theme.text.accent}>{part}</Text>
					: <Text key={index}>{part}</Text>;
			})}
		</Text>
	);
}
