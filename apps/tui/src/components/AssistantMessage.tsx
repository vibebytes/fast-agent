import React from 'react';
import {Box, Text} from 'ink';
import {extractQuery, parseUserSkillDisplay} from '@fastllm/bridge-protocol';
import type {Message} from '../state/model.js';
import {MarkdownContent} from './MarkdownContent.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {truncateEnd} from '../utils/textWidth.js';

type Props = {
	message: Message;
	compact?: boolean;
	streaming?: boolean;
	narration?: boolean;
	/** Continuation chunk of a split assistant message: indent, no prefix. */
	continuation?: boolean;
	/** Render as an error notice. */
	error?: boolean;
	/** Live-region row budget (tail-clamped while streaming). */
	maxLines?: number;
};

const ASSISTANT_INDENT = 2;

export function AssistantMessage({message, compact, streaming, narration, continuation, error, maxLines}: Props) {
	const {theme} = useTheme();

	if (narration && message.role === 'assistant') {
		const narrationText = truncateEnd(message.text, 120);
		return (
			<Box flexDirection="row" marginTop={compact ? 0 : 1}>
				<Box width={ASSISTANT_INDENT} flexShrink={0}>
					<Text dimColor>↳ </Text>
				</Box>
				<Box flexGrow={1}>
					<Text dimColor italic color={theme.text.secondary}>{narrationText}</Text>
				</Box>
			</Box>
		);
	}

	if (message.role === 'user') {
		const display = extractQuery(message.text);
		const skill = parseUserSkillDisplay(display);
		// Turn boundary (claude-code v2 style): the user message is a background
		// strip — the strongest visual anchor in scrollback at zero extra rows —
		// plus a double blank line above (everything else keeps single spacing),
		// so rounds read as paragraphs. The strip hugs the text (claude-code
		// pads right by 1, no full-width fill), keeping copy/paste clean.
		const stripColor = theme.noColor
			? undefined
			: theme.background.userMessage ?? theme.background.focus;
		if (skill) {
			// Align with fast-ide SlashChip: accent chip + args only (no skill body).
			return (
				<Box flexDirection="row" marginTop={compact ? 1 : 2} width="100%">
					<Box backgroundColor={stripColor} paddingRight={1} flexShrink={1}>
						<Text bold color={theme.text.accent}>{'> '}</Text>
						<Text bold color={theme.text.accent}>◆ {skill.name}</Text>
						{skill.args.length > 0 ? (
							<Text color={theme.text.primary}> {skill.args}</Text>
						) : null}
					</Box>
				</Box>
			);
		}
		return (
			<Box flexDirection="row" marginTop={compact ? 1 : 2} width="100%">
				<Box backgroundColor={stripColor} paddingRight={1} flexShrink={1}>
					<Text bold color={theme.text.accent}>{'> '}</Text>
					<Text bold color={theme.text.primary} wrap="wrap">
						{display}
					</Text>
				</Box>
			</Box>
		);
	}

	if (message.role === 'system') {
		const color = error ? theme.status.danger : theme.status.warning;
		return (
			<Box flexDirection="row" marginTop={compact ? 0 : 1} width="100%">
				<Box width={ASSISTANT_INDENT} flexShrink={0}>
					<Text color={color}>{error ? '✗ ' : '◆ '}</Text>
				</Box>
				<Box flexGrow={1}>
					<Text color={error ? theme.status.danger : theme.text.secondary} wrap="wrap">{message.text}</Text>
					{message.detail ? (
						<Text dimColor color={theme.text.muted} wrap="wrap">{message.detail}</Text>
					) : null}
				</Box>
			</Box>
		);
	}

	// Assistant message (or one chunk of a split assistant message).
	return (
		<Box flexDirection="row" marginTop={compact ? 0 : 1} width="100%">
			<Box width={ASSISTANT_INDENT} flexShrink={0}>
				{continuation ? <Text> </Text> : <Text color={theme.text.accent}>✦ </Text>}
			</Box>
			<Box flexDirection="column" flexGrow={1}>
				<MarkdownContent
					text={message.text}
					compact={compact}
					streaming={streaming}
					clamp={maxLines !== undefined ? {mode: 'tail', maxLines} : undefined}
				/>
			</Box>
		</Box>
	);
}
