import React, {createContext, useContext} from 'react';
import type {BridgeCommand} from '../rpc/protocol.js';
import type {DialogSpec} from '../commands/types.js';
import type {Approval} from '../state/model.js';
import type {MentionChip} from '../components/Composer.js';
import type {MentionSuggestGroup} from '../suggestions/SuggestionEngine.js';

export type UIActionsContextValue = {
	send: (command: BridgeCommand) => boolean;
	exit: () => void;
	showDialog: (dialog: DialogSpec) => void;
	closeDialog: () => void;
	submitInput: (text: string, mentions?: MentionChip[]) => void;
	answerQuestion: (id: string, answer: string | {selectedOptionId?: string; customText?: string}) => boolean;
	decideApproval: (approval: Approval, decision: 'y' | 'n' | 'a') => boolean;
	confirmGoal: (goalId: string, patchJson?: string) => boolean;
	cancelGoal: (goalId: string) => boolean;
	resumeGoal: (goalId: string) => boolean;
	steerGoal: (goalId: string, note: string) => boolean;
	escalateGoal: (goalId: string, action: 'resume' | 'fail') => boolean;
	cancelTask: () => void;
	toggleHelp: () => void;
	toggleToolDetail: (path?: string) => void;
	queryMentions: (prefix: string, requestId: string) => void;
	mentionGroups: MentionSuggestGroup[];
	mentionRequestId: string | null;
};

export const UIActionsContext = createContext<UIActionsContextValue | undefined>(undefined);

export function useUIActions(): UIActionsContextValue {
	const ctx = useContext(UIActionsContext);
	if (!ctx) throw new Error('useUIActions must be used within UIActionsContext');
	return ctx;
}
