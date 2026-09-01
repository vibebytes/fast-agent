import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {useTheme} from '../contexts/ThemeContext.js';
import {useUIActions} from '../contexts/UIActionsContext.js';
import {useUIState} from '../contexts/UIStateContext.js';
import {buildPatchJson, editFields, editKey, fieldValue, parseMembers} from '../goal/goalCard.js';
import {graphemes} from '../utils/textWidth.js';
import type {GoalCardState} from '../state/model.js';

type Props = {
	card: GoalCardState;
	focused: boolean;
	onBlur: () => void;
};

/**
 * ②′ Goal card — the ONLY human gate surface in the TUI:
 * awaiting_confirm → full-scope draft edit + Confirm/Cancel;
 * started → busy banner (steer / cancel);
 * escalated → Resume / Fail (+ steer note);
 * finished → completion notice.
 * Inline-pinned; Ctrl+B focuses it (composer keeps working when unfocused).
 */
export function GoalCard({card, focused, onBlur}: Props) {
	const {theme} = useTheme();
	const {dispatch} = useUIState();
	const {confirmGoal, cancelGoal, resumeGoal, steerGoal, escalateGoal} = useUIActions();
	const [selected, setSelected] = useState(0);
	const [edits, setEdits] = useState<Record<string, string>>({});
	const [editing, setEditing] = useState<string | null>(null);
	const [editValue, setEditValue] = useState('');
	const [notice, setNotice] = useState<string | null>(null);
	const [steerMode, setSteerMode] = useState(false);

	const fields = card.phase === 'awaiting_confirm' ? editFields(card) : [];

	const dismiss = () => {
		dispatch({type: 'dismiss_goal_card'});
		onBlur();
	};

	useInput((input, key) => {
		if (!focused) return;
		if (editing !== null || steerMode) {
			if (key.return) {
				if (steerMode) {
					if (editValue.trim()) {
						if (!steerGoal(card.goalId, editValue.trim())) setNotice('SteerGoal 发送失败');
						else setNotice('已捎话（下一步骤边界生效）');
					}
					setSteerMode(false);
				} else if (editing) {
					setEdits(prev => ({...prev, [editing]: editValue}));
					setEditing(null);
				}
				setEditValue('');
				return;
			}
			if (key.escape) {
				setEditing(null);
				setSteerMode(false);
				setEditValue('');
				return;
			}
			if (key.backspace || key.delete) {
				// Grapheme-safe: a raw slice(0, -1) left half a surrogate pair
				// (broken � char) when deleting emoji.
				setEditValue(v => graphemes(v).slice(0, -1).join(''));
				return;
			}
			if (input && !key.ctrl && !key.meta) setEditValue(v => v + input);
			return;
		}

		if (key.escape) {
			if (card.phase === 'finished') dismiss();
			else onBlur();
			return;
		}
		if (card.phase === 'awaiting_confirm') {
			if (key.upArrow) { setSelected(s => (s - 1 + fields.length) % fields.length); return; }
			if (key.downArrow) { setSelected(s => (s + 1) % fields.length); return; }
			if (key.return) {
				const field = fields[selected];
				if (field) {
					setEditing(editKey(field));
					setEditValue(fieldValue(card, field, edits));
				}
				return;
			}
			if (input === 'y' || input === 'Y') {
				const {patchJson, error} = buildPatchJson(edits);
				if (error) { setNotice(error); return; }
				if (!confirmGoal(card.goalId, patchJson)) setNotice('ConfirmGoal 发送失败');
				else setNotice('已提交确认…');
				return;
			}
			if (input === 'x' || input === 'X') {
				if (!cancelGoal(card.goalId)) setNotice('CancelGoal 发送失败');
				return;
			}
		}
		if (card.phase === 'started') {
			if (input === 's' || input === 'S') { setSteerMode(true); setEditValue(''); return; }
			if (input === 'x' || input === 'X') { cancelGoal(card.goalId); return; }
		}
		if (card.phase === 'paused') {
			if (input === 'r' || input === 'R') { resumeGoal(card.goalId); return; }
			if (input === 's' || input === 'S') { setSteerMode(true); setEditValue(''); return; }
			if (input === 'x' || input === 'X') { cancelGoal(card.goalId); return; }
		}
		if (card.phase === 'escalated') {
			if (input === 'r' || input === 'R') { escalateGoal(card.goalId, 'resume'); return; }
			if (input === 'f' || input === 'F') { escalateGoal(card.goalId, 'fail'); return; }
			if (input === 's' || input === 'S') { setSteerMode(true); setEditValue(''); return; }
		}
		if (card.phase === 'finished' && key.return) dismiss();
	}, {isActive: focused});

	const border = focused ? theme.border.focus : theme.border.default;
	const title = {
		awaiting_confirm: 'Goal 待确认（人工门闩）',
		started: 'Goal 执行中',
		paused: 'Goal 已暂停',
		escalated: 'Goal 需要人工介入',
		finished: `Goal 结案：${card.status}`
	}[card.phase];

	return (
		<Box flexDirection="column" borderStyle="round" borderColor={border} paddingX={1} marginBottom={1}>
			<Text bold color={theme.text.primary}>{title}</Text>
			{card.name ? <Text color={theme.text.primary}>{card.name}</Text> : null}
			<Text dimColor>id: {card.goalId}{card.loopAgentId ? ` · line: ${card.loopAgentId.slice(0, 8)}` : ''}</Text>
			{card.statement ? <Text wrap="wrap">目标：{card.statement}</Text> : null}
			{card.acceptance ? <Text dimColor wrap="wrap">验收：{card.acceptance}</Text> : null}
			{card.reason ? <Text color={theme.text.accent} wrap="wrap">原因: {card.reason}</Text> : null}
			{card.resultSummary && card.phase === 'finished' ? <Text wrap="wrap">{card.resultSummary}</Text> : null}

			{card.phase === 'awaiting_confirm' && focused && (
				<Box flexDirection="column" marginTop={1}>
					{fields.map((field, i) => {
						const key = editKey(field);
						const value = fieldValue(card, field, edits);
						const dirty = key in edits ? '*' : ' ';
						const display = value.length > 60 ? value.slice(0, 59) + '…' : value;
						return (
							<Text key={key} color={i === selected ? theme.text.primary : theme.text.muted}>
								{i === selected ? '❯' : ' '}{dirty}{field.label}: {display || '(空)'}
							</Text>
						);
					})}
				</Box>
			)}
			{card.phase === 'awaiting_confirm' && !focused && (
				<Text dimColor>成员：{parseMembers(card.membersJson).map(m => `${m.name}(${m.role})`).join(' ')}</Text>
			)}

			{(editing !== null || steerMode) && (
				<Box marginTop={1}>
					<Text color={theme.text.primary}>{steerMode ? '捎话' : '编辑'}: {editValue}▌</Text>
				</Box>
			)}
			{notice ? <Text color={theme.text.muted}>{notice}</Text> : null}

			<Text dimColor>
				{!focused
					? 'Ctrl+B 操作此卡片'
					: card.phase === 'awaiting_confirm'
					? '↑↓ 选字段 · Enter 编辑 · y 确认执行 · x 取消 Goal · Esc 退出'
					: card.phase === 'started'
						? 's 捎话 · x 取消 Goal · Esc 退出'
						: card.phase === 'paused'
							? 'r 恢复 · s 捎话 · x 取消 Goal · Esc 退出'
							: card.phase === 'escalated'
								? 'r Resume · f Fail · s 捎话 · Esc 退出'
								: 'Enter 关闭'}
			</Text>
		</Box>
	);
}
