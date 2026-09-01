import type {UiState} from '../state/model.js';

export type CommandAction =
	| {type: 'ui.message'; message: string}
	| {type: 'ui.dialog'; dialog: DialogSpec}
	| {type: 'engine.command'; name: string; args: string}
	| {type: 'engine.userMessage'; text: string}
	| {type: 'app.quit'}
	| {type: 'input.replace'; text: string}
	| {type: 'noop'};

export type DialogSpec =
	| {type: 'help'}
	| {type: 'shortcuts'}
	| {type: 'theme'}
	| {type: 'footer'}
	| {type: 'model'}
	| {type: 'taskInspector'; runId?: string}
	| {type: 'sessionBrowser'};

export type SlashCommandKind = 'ui' | 'engine' | 'workspace' | 'skill' | 'agent' | 'mcp';

export type SlashCommandContext = {
	state: UiState;
	sendEngineCommand: (name: string, args: string) => void;
	showDialog: (dialog: DialogSpec) => void;
};

export type SlashCommand = {
	name: string;
	aliases?: string[];
	description: string;
	usage: string;
	kind: SlashCommandKind;
	hidden?: boolean;
	autoExecute?: boolean;
	isSafeConcurrent?: boolean;
	subCommands?: SlashCommand[];
	completion?: (ctx: SlashCommandContext, partial: string) => Suggestion[] | Promise<Suggestion[]>;
	run: (ctx: SlashCommandContext, args: string) => CommandAction;
};

export type Suggestion = {
	value: string;
	label: string;
	description?: string;
	group?: string;
	kind?: SlashCommandKind;
	/** Mentions chip payload (kind+locator); Submit passthrough. */
	payload?: {kind: string; locator: string; entity?: string};
	ref?: string;
};

export type SuggestionGroup = {
	title: string;
	items: Suggestion[];
};
