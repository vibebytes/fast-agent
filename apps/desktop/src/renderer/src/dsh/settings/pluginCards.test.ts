import assert from 'node:assert/strict';
import test from 'node:test';
import {
	asInventory,
	fieldView,
	formatField,
	inventoryMatches,
	keyRef,
	moduleShortName,
	parseField,
	planField,
	pluginCards,
	pluginNs
} from './pluginCards';
import type {SettingsDescribe} from './settings';

const describe: SettingsDescribe = {
	writable: true,
	hasDocument: true,
	namespaces: [
		{
			ns: 'shell',
			schema: {},
			value: {timeoutMs: 60000, maxOutputBytes: 64000},
			base: {timeoutMs: 60000, maxOutputBytes: 64000},
			user: undefined,
			revision: 1
		},
		{
			ns: 'agent-loop',
			schema: {},
			value: {maxParallelToolCalls: 10},
			base: {maxParallelToolCalls: 10},
			revision: 1
		},
		{
			ns: 'web-search-deepseek',
			schema: {},
			value: {apiKeyEnv: 'DEEPSEEK_API_KEY', maxUses: 5},
			base: {maxUses: 5},
			user: {maxUses: 5},
			revision: 2
		}
	]
};

test('pluginNs prefers live shell over the old bash alias', () => {
	assert.equal(pluginNs(describe, ['shell', 'bash'])?.ns, 'shell');
	assert.equal(pluginNs(describe, ['bash', 'shell'])?.ns, 'shell');
	assert.equal(pluginNs({...describe, namespaces: []}, ['shell', 'bash']), undefined);
});

test('plugin cards keep the DSH-Web field subset', () => {
	assert.deepEqual(
		pluginCards.map(c => [c.id, c.fields.map(f => f.key)]),
		[
			['shell', ['timeoutMs', 'maxOutputBytes']],
			['agent-loop', ['maxParallelToolCalls']],
			['web-search', ['apiKey', 'baseURL', 'maxUses']]
		]
	);
});

test('number drafts clear, set, or block like DSH CardForm', () => {
	assert.deepEqual(parseField('number', ''), {kind: 'clear'});
	assert.deepEqual(parseField('number', '10'), {kind: 'set', value: 10});
	assert.equal(parseField('number', 'x'), undefined);
	assert.equal(formatField('number', 10), '10');
	assert.equal(formatField('number', undefined), '');
	assert.deepEqual(
		planField(
			pluginCards[1]!.fields[0]!,
			{text: '10', clear: false},
			10,
			false
		),
		undefined
	);
	assert.deepEqual(
		planField(pluginCards[1]!.fields[0]!, {text: 'x', clear: false}, 10, false),
		{key: 'maxParallelToolCalls', op: 'invalid'}
	);
	assert.deepEqual(
		planField(pluginCards[2]!.fields[2]!, {text: '', clear: false}, 5, true),
		{key: 'maxUses', op: 'unset'}
	);
});

test('secret draft writes only a non-empty key and never into settings', () => {
	assert.equal(parseField('secret', ''), undefined);
	assert.deepEqual(parseField('secret', 'sk-1'), {kind: 'set', value: 'sk-1'});
	assert.deepEqual(
		planField(pluginCards[2]!.fields[0]!, {text: 'sk-1', clear: false}, undefined, false),
		{key: 'apiKey', op: 'secret', value: 'sk-1'}
	);
	assert.equal(
		planField(pluginCards[2]!.fields[0]!, {text: '', clear: false}, undefined, false),
		undefined
	);
	assert.equal(keyRef(pluginNs(describe, ['web-search-deepseek'])), 'DEEPSEEK_API_KEY');
	assert.deepEqual(fieldView(pluginCards[2]!.fields[0]!, undefined, undefined, false), {
		text: '',
		overridden: false,
		invalid: false
	});
});

test('inventory short name, filter, and snapshot parse match DSH-Web', () => {
	const entries = asInventory({
		entries: [
			{entryId: 'a', moduleName: '@deepseek-ai/dsh-host-plugin-inventory', enabled: true, fiberPhase: 'active'},
			{entryId: 'b', moduleName: 'cordis-plugin-timer', enabled: false, fiberPhase: null},
			{entryId: 'c', moduleName: 'hmr', enabled: true, fiberPhase: 'failed'}
		]
	});
	assert.equal(moduleShortName(entries[0]!.moduleName), 'plugin-inventory');
	assert.equal(moduleShortName(entries[1]!.moduleName), 'timer');
	assert.equal(inventoryMatches(entries[1]!, 'tim'), true);
	assert.equal(inventoryMatches(entries[2]!, 'tim'), false);
	assert.equal(entries[1]!.enabled, false);
	assert.equal(entries[1]!.fiberPhase, null);
});
