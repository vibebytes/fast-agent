import type {CommandInfo} from '../state/model.js';
import type {CommandAction, SlashCommand, SlashCommandContext} from './types.js';
import {
	COMMAND_SPECS,
	commandSpecToInfo,
	findCommandSpec,
	mergeEngineCommandInfo,
	visibleCommandSpecs
} from './commandSpec.js';

export function createBuiltinCommands(): SlashCommand[] {
	return visibleCommandSpecs().map(spec => ({
		name: spec.name,
		aliases: spec.aliases,
		description: spec.description,
		usage: spec.usage,
		kind: spec.owner === 'ui' ? 'ui' as const : 'engine' as const,
		hidden: spec.availability === 'hidden',
		isSafeConcurrent: spec.owner === 'ui' || spec.name === 'model' || spec.name === 'task' || spec.name === 'tasks' || spec.name === 'inspect',
		run: (_ctx, _args): CommandAction => {
			if (spec.owner === 'ui') {
				return {type: 'ui.dialog', dialog: uiDialogFor(spec.name)};
			}
			return {type: 'engine.command', name: spec.name, args: _args};
		}
	}));
}

function uiDialogFor(name: string): import('./types.js').DialogSpec {
	switch (name) {
		case 'help': return {type: 'help'};
		case 'shortcuts': return {type: 'shortcuts'};
		case 'theme': return {type: 'theme'};
		case 'footer': return {type: 'footer'};
		case 'debug-events': return {type: 'taskInspector'};
		default: return {type: 'help'};
	}
}

export function mergeEngineCommands(builtin: SlashCommand[], engineAvailable: CommandInfo[]): SlashCommand[] {
	const mergedInfo = mergeEngineCommandInfo(COMMAND_SPECS, engineAvailable);
	const byName = new Map(builtin.map(cmd => [cmd.name, cmd]));
	for (const info of mergedInfo) {
		const spec = findCommandSpec(info.name);
		if (spec?.owner === 'ui') continue;
		const existing = byName.get(info.name);
		if (existing) {
			byName.set(info.name, {
				...existing,
				description: info.description || existing.description,
				usage: info.usage || existing.usage,
				kind: 'engine'
			});
		} else {
			byName.set(info.name, {
				name: info.name,
				description: info.description,
				usage: info.usage,
				kind: 'engine',
				isSafeConcurrent: true,
				run: (_ctx, args): CommandAction => ({type: 'engine.command', name: info.name, args})
			});
		}
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findSlashCommand(commands: SlashCommand[], input: string): SlashCommand | undefined {
	const trimmed = input.startsWith('/') ? input.slice(1) : input;
	const [name] = trimmed.split(/\s+/);
	return commands.find(cmd => cmd.name === name || cmd.aliases?.includes(name ?? ''));
}

export function parseSlashInput(text: string): {name: string; args: string} | undefined {
	if (!text.startsWith('/')) return undefined;
	const trimmed = text.slice(1).trim();
	if (trimmed.length === 0) return undefined;
	const [name, ...rest] = trimmed.split(/\s+/);
	return {name: name ?? '', args: rest.join(' ')};
}

export function executeSlashCommand(
	command: SlashCommand,
	ctx: SlashCommandContext,
	args: string
): CommandAction {
	return command.run(ctx, args);
}

export function allCommandInfo(engineCommands: CommandInfo[] = []): CommandInfo[] {
	const ui = visibleCommandSpecs()
		.filter(spec => spec.owner === 'ui')
		.map(spec => commandSpecToInfo(spec));
	const engine = mergeEngineCommandInfo(COMMAND_SPECS, engineCommands);
	return [...ui, ...engine].sort((a, b) => a.name.localeCompare(b.name));
}

export type CommandRegistry = {
	commands: SlashCommand[];
	find: (input: string) => SlashCommand | undefined;
	complete: (partial: string) => SlashCommand[];
	allInfo: () => CommandInfo[];
};

export function createCommandRegistry(engineCommands: CommandInfo[] = []): CommandRegistry {
	const commands = mergeEngineCommands(createBuiltinCommands(), engineCommands);
	return {
		commands,
		find: input => findSlashCommand(commands, input),
		complete: partial => {
			const query = partial.startsWith('/') ? partial.slice(1).split(/\s+/)[0] ?? '' : partial;
			return commands.filter(cmd => cmd.name.startsWith(query));
		},
		allInfo: () => allCommandInfo(engineCommands)
	};
}

export {commandSpecToInfo};
