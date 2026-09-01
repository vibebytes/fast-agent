import React from 'react';
import {Box, Text} from 'ink';
import type {AgentCallTimelineItem} from '../state/timeline/model.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {useSharedSpinnerFrame} from '../hooks/useSharedSpinner.js';
import {isScreenReader} from '../terminal/capabilityManager.js';

type Props = {
	item: AgentCallTimelineItem;
};

/**
 * Subagent row in the transcript (design §11.1): tree connectors computed by
 * the adapter, spinner + live activity + running stats while in flight,
 * `✓ name · N tools · Xs · Ytk` plus a one-line result summary once done.
 * Trunk rows make the delegating parent visible over ≥2 concurrent siblings.
 */
export function AgentCallMessage({item}: Props) {
	const {theme} = useTheme();
	const {frame, index} = useSharedSpinnerFrame(item.status === 'running');

	// treePrefix comes from the batch tree; legacy items (restored sessions)
	// fall back to the old depth indent.
	const branch = item.treePrefix ?? `${'  '.repeat(Math.max(0, item.depth - 1))}${item.depth > 0 ? '├─ ' : ''}`;

	const icon = item.status === 'running'
		? (isScreenReader() ? '…' : frame)
		: item.status === 'success' ? '✓' : '✗';
	const iconColor = item.status === 'running'
		? theme.spinner[index % theme.spinner.length] ?? theme.status.running
		: item.status === 'success' ? theme.status.success : theme.status.danger;

	const liveElapsed = item.status === 'running' && item.startedAt !== undefined
		? Date.now() - item.startedAt
		: undefined;
	const stats = item.status === 'running'
		? [
			item.toolCalls > 0 && `${item.toolCalls} tools`,
			liveElapsed !== undefined && liveElapsed >= 1000 && formatElapsed(liveElapsed)
		]
		: [
			item.toolCalls > 0 && `${item.toolCalls} tools`,
			item.elapsedMs !== undefined && formatElapsed(item.elapsedMs),
			item.tokensUsed !== undefined && `${item.tokensUsed}tk`
		];
	const statsText = stats.filter(Boolean).join(' · ');

	const label = item.trunk ? trunkLabel(item) : item.name;
	const activity = !item.trunk && item.status === 'running' && item.currentTool
		? `→ ${item.currentTool}`
		: undefined;

	// The second line: WHY it failed, or WHAT it produced — a bare ✓/✗ is opaque.
	const underline = item.status === 'failed'
		? (item.detail ?? '失败')
		: item.status === 'success' && item.resultSummary
			? item.resultSummary
			: undefined;
	const underlineColor = item.status === 'failed' ? theme.status.danger : theme.text.muted;

	const stickyTitle = (
		<Text wrap="truncate">
			<Text dimColor color={theme.text.muted}>{branch}</Text>
			<Text color={iconColor}>{icon}</Text>
			<Text> </Text>
			<Text bold={item.status === 'running'}>{label}</Text>
			{item.isRetry && <Text dimColor color={theme.text.muted}> (retry)</Text>}
			{statsText.length > 0 && <Text dimColor color={theme.text.muted}>  · {statsText}</Text>}
		</Text>
	);

	return (
		<Box flexDirection="column" width="100%">
			<Box sticky="top" opaque width="100%" stickyChildren={stickyTitle}>
				<Text wrap="truncate">
					<Text dimColor color={theme.text.muted}>{branch}</Text>
					<Text color={iconColor}>{icon}</Text>
					<Text> </Text>
					<Text bold={item.status === 'running'}>{label}</Text>
					{item.isRetry && <Text dimColor color={theme.text.muted}> (retry)</Text>}
					{activity && <Text dimColor color={theme.text.muted}>  {activity}</Text>}
					{statsText.length > 0 && <Text dimColor color={theme.text.muted}>  · {statsText}</Text>}
				</Text>
			</Box>
			{underline && (
				<Text wrap="truncate">
					<Text dimColor color={theme.text.muted}>{item.summaryIndent ?? ''}  </Text>
					<Text dimColor color={underlineColor}>└ {underline}</Text>
				</Text>
			)}
		</Box>
	);
}

function trunkLabel(item: AgentCallTimelineItem): string {
	const trunk = item.trunk!;
	if (item.status === 'running') {
		const done = trunk.total - trunk.running;
		return `${item.name} — ${trunk.total} 个委派 (${trunk.running} running${done > 0 ? `, ${done} done` : ''})`;
	}
	return `${item.name} — ${trunk.total} 个委派`;
}

function formatElapsed(ms: number): string {
	return ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`;
}
