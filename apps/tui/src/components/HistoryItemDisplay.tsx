import React from 'react';
import type {TimelineItem} from '../state/timeline/model.js';
import {AssistantMessage} from './AssistantMessage.js';
import {ThinkingBlock} from './ThinkingBlock.js';
import {ToolGroupMessage} from './tools/ToolGroupMessage.js';
import {ApprovalDialog} from './dialogs/ApprovalDialog.js';
import {QuestionDialog} from './dialogs/QuestionDialog.js';
import {CommandResultMessage} from './CommandResultMessage.js';
import {AgentCallMessage} from './AgentCallMessage.js';

type Props = {
	item: TimelineItem;
	onQuestionAnswer?: (id: string, answer: string | {selectedOptionId?: string; customText?: string}) => void;
};

function HistoryItemDisplayInner({item, onQuestionAnswer}: Props) {
	switch (item.kind) {
		case 'user_message':
			return <AssistantMessage message={{id: item.id, role: 'user', text: item.text}} compact={item.compact} />;
		case 'assistant_message':
			return (
				<AssistantMessage
					message={{id: item.id, role: 'assistant', text: item.text}}
					compact={item.compact}
					streaming={item.streaming}
					narration={item.narration}
					continuation={item.continuation}
				/>
			);
		case 'thinking_message':
			return (
				<ThinkingBlock
					text={item.text}
					running={item.running === true}
					compact={item.compact}
					collapsed={item.collapsed}
					hideBody={item.hideBody}
					waitLabel={item.waitLabel}
				/>
			);
		case 'tool_group':
			return <ToolGroupMessage tools={item.tools} expanded={item.expanded} compact={item.compact} />;
		case 'system_message':
			if (item.variant === 'command_result') {
				return <CommandResultMessage item={item} />;
			}
			return <AssistantMessage message={{id: item.id, role: 'system', text: item.text, detail: item.detail}} compact={item.compact} />;
		case 'error_message':
			return <AssistantMessage message={{id: item.id, role: 'system', text: item.text}} error />;
		case 'approval_message':
			return <ApprovalDialog approval={item.approval} />;
		case 'question_message':
			return <QuestionDialog question={item.question} onAnswer={onQuestionAnswer ?? (() => {})} />;
		case 'task_event':
			return <AssistantMessage message={{id: item.id, role: 'system', text: `[${item.eventType}] ${item.text}`}} />;
		case 'agent_call':
			return <AgentCallMessage item={item} />;
		default:
			return null;
	}
}

/**
 * Memoized: settled items keep stable references between renders, so during
 * streaming only the live tail re-renders its subtree.
 */
export const HistoryItemDisplay = React.memo(HistoryItemDisplayInner);
