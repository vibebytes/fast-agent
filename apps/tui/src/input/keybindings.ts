export enum Command {
	RETURN = 'basic.confirm',
	ESCAPE = 'basic.cancel',
	QUIT = 'basic.quit',
	MOVE_UP = 'cursor.up',
	MOVE_DOWN = 'cursor.down',
	MOVE_LEFT = 'cursor.left',
	MOVE_RIGHT = 'cursor.right',
	HISTORY_UP = 'history.previous',
	HISTORY_DOWN = 'history.next',
	REVERSE_SEARCH = 'history.search.start',
	ACCEPT_SUGGESTION = 'suggest.accept',
	COMPLETION_UP = 'suggest.focusPrevious',
	COMPLETION_DOWN = 'suggest.focusNext',
	SUBMIT = 'input.submit',
	QUEUE_MESSAGE = 'input.queueMessage',
	NEWLINE = 'input.newline',
	CLEAR_INPUT = 'edit.clear',
	TOGGLE_TOOL_DETAIL = 'app.toggleToolDetail',
	TOGGLE_HELP = 'app.toggleHelp',
	TOGGLE_FOOTER = 'app.toggleFooter',
	CANCEL_TASK = 'task.cancel',
	DIALOG_NEXT = 'dialog.next',
	DIALOG_PREV = 'dialog.prev',
	SUBAGENT_DRILL = 'app.subagentDrill',
	GOAL_CARD = 'app.goalCard'
}

export type KeyInput = {
	input: string;
	key: {
		upArrow?: boolean;
		downArrow?: boolean;
		leftArrow?: boolean;
		rightArrow?: boolean;
		return?: boolean;
		escape?: boolean;
		tab?: boolean;
		backspace?: boolean;
		delete?: boolean;
		ctrl?: boolean;
		shift?: boolean;
		meta?: boolean;
	};
};

export type Keybinding = {
	command: Command;
	match: (input: KeyInput) => boolean;
};

/**
 * First match wins. Arrow keys map to MOVE_UP/MOVE_DOWN only — consumers
 * decide the context-specific meaning (suggestion focus vs input history).
 * Esc maps to ESCAPE only — consumers layer clear-input / dismiss / cancel.
 */
export const defaultKeybindings: Keybinding[] = [
	{command: Command.RETURN, match: ({key}) => key.return === true && key.shift !== true},
	{command: Command.NEWLINE, match: ({key}) => key.return === true && key.shift === true},
	{command: Command.ESCAPE, match: ({key}) => key.escape === true},
	{command: Command.MOVE_UP, match: ({key}) => key.upArrow === true},
	{command: Command.MOVE_DOWN, match: ({key}) => key.downArrow === true},
	{command: Command.MOVE_LEFT, match: ({key}) => key.leftArrow === true},
	{command: Command.MOVE_RIGHT, match: ({key}) => key.rightArrow === true},
	{command: Command.REVERSE_SEARCH, match: ({input, key}) => key.ctrl === true && input === 'r'},
	{command: Command.ACCEPT_SUGGESTION, match: ({key}) => key.tab === true},
	{command: Command.CLEAR_INPUT, match: ({input, key}) => key.ctrl === true && input === 'u'},
	{command: Command.TOGGLE_TOOL_DETAIL, match: ({input, key}) => key.ctrl === true && input === 'o'},
	{command: Command.TOGGLE_HELP, match: ({input, key}) => key.ctrl === true && input === 'h'},
	{command: Command.TOGGLE_FOOTER, match: ({input, key}) => key.ctrl === true && input === 'f'},
	{command: Command.CANCEL_TASK, match: ({input, key}) => key.ctrl === true && input === 'c'},
	{command: Command.QUEUE_MESSAGE, match: ({input, key}) => key.ctrl === true && input === 's'},
	{command: Command.SUBAGENT_DRILL, match: ({input, key}) => key.ctrl === true && input === 'g'},
	{command: Command.GOAL_CARD, match: ({input, key}) => key.ctrl === true && input === 'b'}
];

export function matchKeybinding(input: KeyInput, bindings: Keybinding[] = defaultKeybindings): Command | undefined {
	for (const binding of bindings) {
		if (binding.match(input)) {
			return binding.command;
		}
	}
	return undefined;
}

export function commandLabel(command: Command): string {
	const labels: Partial<Record<Command, string>> = {
		[Command.RETURN]: 'Enter',
		[Command.ESCAPE]: 'Esc',
		[Command.NEWLINE]: 'Shift+Enter',
		[Command.MOVE_UP]: '↑',
		[Command.MOVE_DOWN]: '↓',
		[Command.HISTORY_UP]: '↑',
		[Command.HISTORY_DOWN]: '↓',
		[Command.REVERSE_SEARCH]: 'Ctrl+R',
		[Command.ACCEPT_SUGGESTION]: 'Tab',
		[Command.CLEAR_INPUT]: 'Ctrl+U / Esc',
		[Command.TOGGLE_TOOL_DETAIL]: 'Ctrl+O',
		[Command.TOGGLE_HELP]: 'Ctrl+H',
		[Command.TOGGLE_FOOTER]: 'Ctrl+F',
		[Command.CANCEL_TASK]: 'Ctrl+C',
		[Command.QUEUE_MESSAGE]: 'Ctrl+S',
		[Command.SUBAGENT_DRILL]: 'Ctrl+G',
		[Command.GOAL_CARD]: 'Ctrl+B'
	};
	return labels[command] ?? command;
}
