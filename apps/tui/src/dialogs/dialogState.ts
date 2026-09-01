import type {DialogSpec} from '../commands/types.js';
import type {Approval, CommandInfo, FooterConfig, UserQuestion} from '../state/model.js';
import {defaultFooterConfig} from '../state/model.js';
import {getThemeNames} from '../theme/semanticTheme.js';
import type {SemanticTheme} from '../theme/semanticTheme.js';

export type ActiveDialog =
	| {type: 'help'; commands: CommandInfo[]}
	| {type: 'shortcuts'}
	| {type: 'theme'; selected: number}
	| {type: 'footer'; selected: number; config: FooterConfig}
	| {type: 'model'; models: string[]; selected: number}
	| {type: 'taskInspector'; runId?: string; events: string[]}
	| {type: 'sessionBrowser'; selected: number}
	| {type: 'approval'; approval: Approval; selected: number}
	| {type: 'question'; question: UserQuestion; selected: number};

export type DialogState = {
	active?: ActiveDialog;
	stack: ActiveDialog[];
};

export const initialDialogState: DialogState = {
	active: undefined,
	stack: []
};

export function openDialog(state: DialogState, dialog: ActiveDialog): DialogState {
	return {
		active: dialog,
		stack: state.active ? [...state.stack, state.active] : state.stack
	};
}

export function closeDialog(state: DialogState): DialogState {
	const previous = state.stack.at(-1);
	return {
		active: previous,
		stack: state.stack.slice(0, -1)
	};
}

export function dialogFromSpec(
	spec: DialogSpec,
	ctx: {commands: CommandInfo[]; debugEvents: string[]; footerConfig?: FooterConfig; currentTheme?: string}
): ActiveDialog {
	switch (spec.type) {
		case 'help':
			return {type: 'help', commands: ctx.commands};
		case 'shortcuts':
			return {type: 'shortcuts'};
		case 'theme': {
			const names = getThemeNames();
			const i = ctx.currentTheme ? names.indexOf(ctx.currentTheme) : -1;
			return {type: 'theme', selected: i >= 0 ? i : 0};
		}
		case 'footer':
			return {type: 'footer', selected: 0, config: {...(ctx.footerConfig ?? defaultFooterConfig)}};
		case 'model':
			return {type: 'model', models: [], selected: 0};
		case 'taskInspector':
			return {type: 'taskInspector', runId: spec.runId, events: ctx.debugEvents};
		case 'sessionBrowser':
			return {type: 'sessionBrowser', selected: 0};
	}
}

export const APPROVAL_OPTIONS = [
	{id: 'once', label: 'Yes'},
	{id: 'always', label: 'Yes, always for this session'},
	{id: 'deny', label: 'No'}
] as const;

export function dialogTitle(dialog: ActiveDialog, theme: SemanticTheme): string {
	switch (dialog.type) {
		case 'help': return 'Help';
		case 'shortcuts': return 'Keyboard Shortcuts';
		case 'theme': return 'Theme';
		case 'footer': return 'Footer Configuration';
		case 'model': return 'Model';
		case 'taskInspector': return 'Task Inspector';
		case 'sessionBrowser': return 'Sessions';
		case 'approval': return 'Approval Required';
		case 'question': return dialog.question.title ?? 'Question';
		default: return 'Dialog';
	}
}

export function moveSelection(selected: number, count: number, direction: 'up' | 'down'): number {
	if (count <= 0) return 0;
	const delta = direction === 'up' ? -1 : 1;
	return (selected + delta + count) % count;
}
