import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandRegistry, parseSlashInput, findSlashCommand, allCommandInfo} from './registry.js';

test('parseSlashInput extracts name and args', () => {
	assert.deepEqual(parseSlashInput('/model gpt-4'), {name: 'model', args: 'gpt-4'});
	assert.equal(parseSlashInput('hello'), undefined);
});

test('command registry merges engine commands without overriding ui-only', () => {
	const registry = createCommandRegistry([
		{name: 'custom', description: 'Custom cmd', usage: '/custom', available: true}
	]);
	assert.ok(registry.commands.some(c => c.name === 'custom'));
	assert.ok(registry.commands.some(c => c.name === 'help'));
	const help = registry.commands.find(c => c.name === 'help');
	assert.equal(help?.kind, 'ui');
});

test('findSlashCommand resolves aliases', () => {
	const registry = createCommandRegistry([]);
	const cmd = findSlashCommand(registry.commands, '/reset');
	assert.equal(cmd?.name, 'new');
});

test('allInfo includes ui and engine commands', () => {
	const info = allCommandInfo([]);
	assert.ok(info.some(c => c.name === 'help'));
	assert.ok(info.some(c => c.name === 'model'));
	assert.ok(info.some(c => c.name === 'run'));
});

test('complete filters slash commands', () => {
	const registry = createCommandRegistry([]);
	const results = registry.complete('mod');
	assert.ok(results.some(c => c.name === 'model'));
});
