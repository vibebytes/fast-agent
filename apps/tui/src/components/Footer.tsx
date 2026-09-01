import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import os from 'node:os';
import type {FooterConfig, FooterItemId, UiState} from '../state/model.js';
import {quickActionAvailability} from '../commands/router.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {compactPath, truncateEnd, visualWidth} from '../utils/textWidth.js';
import {useTerminalSize} from '../hooks/useTerminalSize.js';
import {useTokenMetrics} from '../hooks/useTokenMetrics.js';

/** Engine silence beyond this (with heartbeat probing active) is surfaced as a health warning. */
const ENGINE_SILENT_AFTER_MS = 5_000;

export type FooterItem = {
	id: string;
	priority: number;
	/** gemini-cli layout: session identity on the left, live metrics on the right. */
	side: 'left' | 'right';
	label?: string;
	render: (state: UiState, metrics: FooterMetrics) => string | undefined;
};

export type FooterMetrics = {
	tokenRate: number;
	sparkline: string;
	runningLabel?: string;
	/** Seconds since the engine last spoke, once past the warning threshold. */
	engineSilentSeconds?: number;
};

function tildeify(path: string): string {
	const home = os.homedir();
	return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export const defaultFooterItems: FooterItem[] = [
	{id: 'e2e-state', priority: -1, side: 'left', render: s => process.env.FAST_E2E_STATE === '1' ? `e2e:${s.inputMode}:${s.transcript.awaitingCancelSettlement ? 'stopping' : s.running ? 'running' : 'idle'}` : undefined},
	{id: 'errors', priority: 0, side: 'left', render: s => s.errors.length > 0 ? `errors:${s.errors.length}` : undefined},
	// Proactive liveness: the user learns the engine is gone BEFORE pressing a
	// key into a dead approval dialog, not 10s after.
	{id: 'health', priority: 0.5, side: 'left', render: (_s, metrics) =>
		metrics.engineSilentSeconds !== undefined ? `引擎无响应 ${metrics.engineSilentSeconds}s` : undefined},
	{id: 'cwd', priority: 1, side: 'left', render: s => compactPath(tildeify(s.cwd), 32)},
	{id: 'queue', priority: 2, side: 'left', render: s => s.queue.length > 0 ? `queue:${s.queue.length}` : undefined},
	// Idle says nothing (gemini/claude-code style); only surface abnormal states.
	{id: 'task', priority: 3, side: 'left', render: (s, metrics) =>
		s.transcript.awaitingCancelSettlement
			? 'stopping'
			: s.running
				? (metrics.runningLabel ?? 'running')
				: undefined},
	// Agent mode badge (Yolo/Plan/Ask): the approval posture, independent of input state.
	{id: 'agent-mode', priority: 3.5, side: 'left', render: s =>
		s.agentMode !== 'normal' ? s.agentMode.charAt(0).toUpperCase() + s.agentMode.slice(1) : undefined},
	// Bare r/c quick keys (doc §8) — visible only when they would fire.
	{id: 'quick-keys', priority: 3.6, side: 'left', render: s => {
		const q = quickActionAvailability(s);
		const parts: string[] = [];
		if (q.retryRunId) parts.push('r 重试');
		if (q.continueReady) parts.push('c 继续');
		return parts.length > 0 ? parts.join(' · ') : undefined;
	}},
	{id: 'mode', priority: 4, side: 'left', render: s => s.inputMode !== 'normal' ? s.inputMode : undefined},
	{id: 'admin', priority: 5, side: 'right', render: s => s.adminUrl ? `admin:${s.adminUrl.replace('http://', '')}` : undefined},
	{id: 'model', priority: 6, side: 'right', render: s => s.modelDisplay ?? s.model},
	{id: 'tokens', priority: 7, side: 'right', render: (s, metrics) => {
		if (s.tokensUsed <= 0) return undefined;
		return metrics.tokenRate > 0 ? `${s.tokensUsed}tk ${metrics.tokenRate}/s` : `${s.tokensUsed}tk`;
	}},
	{id: 'trust', priority: 8, side: 'right', render: () => undefined}
];

type Props = {
	state: UiState;
	items?: FooterItem[];
	visible?: boolean;
	footerConfig?: FooterConfig;
};

/**
 * Single status line (claude-code/gemini-cli style): no border, no filler
 * rows; left side = session identity, right side = live metrics. The whole
 * line is width-fitted with CJK-accurate math so it can never wrap and push
 * the composer around.
 */
export function Footer({state, items = defaultFooterItems, visible = true, footerConfig}: Props) {
	const {theme} = useTheme();
	const {columns} = useTerminalSize();
	const width = Math.max(20, columns - 1);
	const tokenMetrics = useTokenMetrics(state.tokensUsed, state.running);
	// Engine silence only advances when nothing arrives, so state changes never
	// re-render this — tick locally while liveness matters.
	const [now, setNow] = useState(() => Date.now());
	const watchLiveness = state.ready && state.inputMode !== 'exited' && state.lastEngineEventAt !== undefined;
	useEffect(() => {
		if (!watchLiveness) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [watchLiveness]);
	const silentMs = watchLiveness ? now - (state.lastEngineEventAt ?? now) : 0;
	const metrics: FooterMetrics = {
		...tokenMetrics,
		engineSilentSeconds: silentMs >= ENGINE_SILENT_AFTER_MS ? Math.floor(silentMs / 1000) : undefined
	};
	if (!visible) return null;

	const config = footerConfig ?? state.footerConfig;
	const sorted = [...items].sort((a, b) => a.priority - b.priority);
	const leftParts: string[] = [];
	const rightParts: string[] = [];

	for (const item of sorted) {
		if (config[item.id as FooterItemId] === false) continue;
		const value = item.render(state, metrics);
		if (!value) continue;
		// If it's the admin url or model, always put on the right.
		// If it's errors, put on the left.
		(item.side === 'right' ? rightParts : leftParts).push(item.label ? `${item.label}:${value}` : value);
	}

	const left = [
		state.ready ? undefined : 'starting',
		...leftParts
	].filter(Boolean).join(' · ');

	const rightStatic = rightParts.join(' · ');
	const rightLive = [
		state.running ? metrics.sparkline : undefined,
		state.running ? '●' : undefined
	].filter(Boolean).join(' ');

	const rightWidth = visualWidth(rightStatic) + (rightLive ? visualWidth(rightLive) + 1 : 0);
	
	// Ensure leftBudget leaves enough space for right parts, but don't let leftText truncate right parts.
	// If left side has errors, we want to make sure we don't squeeze out too much, but right parts should remain visible.
	// Let's budget left side with a minimum of 8 columns, but cap it so rightStatic is always fully rendered.
	const leftBudget = Math.max(8, width - rightWidth - (rightWidth > 0 ? 2 : 0));
	const leftText = truncateEnd(left, leftBudget);
	const gap = Math.max(1, width - visualWidth(leftText) - rightWidth);

	return (
		<Box flexDirection="row" width="100%">
			<Text dimColor color={theme.text.muted}>{leftText}</Text>
			{rightWidth > 0 && (
				<>
					<Text dimColor color={theme.text.muted}>{' '.repeat(gap)}{rightStatic}</Text>
					{rightLive.length > 0 && (
						<Text color={theme.status.running}> {rightLive}</Text>
					)}
				</>
			)}
		</Box>
	);
}
