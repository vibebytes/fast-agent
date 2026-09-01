import assert from 'node:assert/strict';
import test from 'node:test';
import {asRoster, copyPayload, draftBlocker, groupPresets} from './presetJoin';

const rows = [
	{id: 'standard', trust: 'system' as const, isDefault: true},
	{id: 'mine', trust: 'user' as const, isDefault: false}
];

test('asRoster reads DSH agentPreset.list and treats missing trust as system', () => {
	const roster = asRoster({
		authorable: true,
		hasDocument: true,
		presets: [
			{id: 'standard', trust: 'system', isDefault: true, name: 'Standard'},
			{id: 'mine', trust: 'user', broken: 'bad yml'},
			{id: ''}
		]
	});
	assert.equal(roster.authorable, true);
	assert.equal(roster.hasDocument, true);
	assert.equal(roster.presets.length, 2);
	assert.equal(roster.presets[1]?.broken, 'bad yml');
	assert.equal(asRoster({presets: [{id: 'code'}]}).presets[0]?.trust, 'system');
});

test('draftBlocker matches DSH copy-dialog gates', () => {
	assert.equal(draftBlocker({from: 'standard', id: '', name: ''}, rows), 'idRequired');
	assert.equal(draftBlocker({from: 'standard', id: '../escape', name: ''}, rows), 'idInvalid');
	assert.equal(draftBlocker({from: 'standard', id: 'Upper', name: ''}, rows), 'idInvalid');
	assert.equal(draftBlocker({from: 'standard', id: 'mine', name: ''}, rows), 'idTaken');
	assert.equal(draftBlocker({from: 'standard', id: 'my-copy', name: ''}, rows), undefined);
});

test('copyPayload omits a blank name so the host falls back to the id', () => {
	assert.deepEqual(copyPayload({from: 'standard', id: 'my-copy', name: '我的模式'}), {
		from: 'standard',
		agentPreset: 'my-copy',
		name: '我的模式'
	});
	assert.deepEqual(copyPayload({from: 'standard', id: 'my-copy', name: '   '}), {
		from: 'standard',
		agentPreset: 'my-copy'
	});
});

test('groupPresets splits 内置 / 自定义 like DSH-Web', () => {
	const groups = groupPresets([
		{id: 'standard', trust: 'system', isDefault: true},
		{id: 'code', trust: 'system', isDefault: false},
		{id: 'mine', trust: 'user', isDefault: false}
	]);
	assert.deepEqual(
		groups.system.map(r => r.id),
		['standard', 'code']
	);
	assert.deepEqual(
		groups.user.map(r => r.id),
		['mine']
	);
});
