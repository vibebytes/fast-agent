import React, {useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import {useTheme} from '../contexts/ThemeContext.js';
import {activeAgent, breadcrumbs, viewDepth} from '../state/agentViewStack.js';
import type {UiState} from '../state/model.js';
import type {UiAction} from '../state/reducer.js';
import {isComposerDraftEmpty} from '../state/composerDraft.js';

type Props = {
	state: UiState;
	dispatch: React.Dispatch<UiAction>;
	/** Fired when the drilled agent changes (push / sibling switch) so the host can FetchAgentTimeline. */
	onNavigate?: (agentId: string) => void;
};

/**
 * Drill-down view for a subagent (design §11.2–11.3): breadcrumb path, the
 * agent's fetched timeline, and a navigation footer. Esc pops one level,
 * ←/→ switch between siblings of the same parent.
 */
export function SubagentFooter({state, dispatch, onNavigate}: Props) {
	const {theme} = useTheme();
	const depth = viewDepth(state.agentViewStack);
	const current = activeAgent(state.agentViewStack);
	const currentAgentId = current?.agentId;

	useInput((input, key) => {
		if (depth <= 0) return;
		if (key.escape) {
			dispatch({type: 'agent_view_pop'});
			return;
		}
		// Focus arbitration: while the composer holds a draft, ←/→ belong to
		// the text cursor (ink broadcasts keys to every active handler, so
		// without this both the caret AND the sibling view would move).
		if ((key.leftArrow || key.rightArrow) && !isComposerDraftEmpty()) return;
		if (key.leftArrow) {
			dispatch({type: 'agent_view_sibling', direction: 'prev'});
			return;
		}
		if (key.rightArrow) {
			dispatch({type: 'agent_view_sibling', direction: 'next'});
		}
	}, {isActive: depth > 0});

	useEffect(() => {
		if (currentAgentId) onNavigate?.(currentAgentId);
	}, [currentAgentId, onNavigate]);

	if (depth <= 0 || !current) return null;

	const crumbs = breadcrumbs(state.agentViewStack);
	const siblingCount = current.siblings.length;
	const siblingIdx = current.siblings.findIndex(s => s.agentId === current.agentId);
	const siblingLabel = siblingCount > 1 ? ` [${siblingIdx + 1}/${siblingCount}]` : '';
	// Named targets so ←/→ is never a blind switch.
	const prevSibling = current.siblings[(siblingIdx - 1 + siblingCount) % siblingCount];
	const nextSibling = current.siblings[(siblingIdx + 1) % siblingCount];
	const timeline = state.agentTimelines[current.agentId];
	const run = state.agentRuns.find(r => r.agentId === current.agentId);
	const stats = [
		run && run.toolCalls > 0 && `${run.toolCalls} tools`,
		run?.elapsedMs !== undefined && `${(run.elapsedMs / 1000).toFixed(1)}s`,
		run?.tokensUsed !== undefined && `${run.tokensUsed} tokens`
	].filter(Boolean).join(' · ');

	return (
		<Box flexDirection="column" width="100%" borderStyle="round" borderColor={theme.text.muted} paddingX={1}>
			<Text wrap="truncate">
				{crumbs.map((name, i) => (
					<React.Fragment key={i}>
						{i > 0 && <Text dimColor color={theme.text.muted}> {'>'} </Text>}
						<Text bold={i === crumbs.length - 1}>{name}</Text>
					</React.Fragment>
				))}
				<Text dimColor color={theme.text.muted}>{siblingLabel}</Text>
			</Text>
			{timeline === undefined ? (
				<Text dimColor color={theme.text.muted}>加载 agent 时间线…</Text>
			) : (
				<Box flexDirection="column">
					{timeline.turns.length === 0 && (
						<Text dimColor color={theme.text.muted}>（暂无消息记录）</Text>
					)}
					{timeline.turns.slice(-6).map(turn => (
						<Box key={turn.turnId} flexDirection="column">
							{turn.userText.length > 0 && (
								<Text wrap="truncate" dimColor color={theme.text.muted}>{'> '}{firstLine(turn.userText)}</Text>
							)}
							{turn.assistantText.length > 0 && (
								<Text wrap="truncate">✦ {firstLine(turn.assistantText)}</Text>
							)}
						</Box>
					))}
					{timeline.children.length > 0 && (
						<Text wrap="truncate" dimColor color={theme.text.muted}>
							子 agent: {timeline.children.map(c => c.name).join(', ')}
						</Text>
					)}
				</Box>
			)}
			<Text wrap="truncate" dimColor color={theme.text.muted}>
				Parent [Esc]{siblingCount > 1 ? `  [←] ${prevSibling?.name ?? ''}  [→] ${nextSibling?.name ?? ''}` : ''}{stats.length > 0 ? `   ${stats}` : ''}
			</Text>
		</Box>
	);
}

function firstLine(text: string): string {
	return text.split('\n', 1)[0] ?? '';
}
