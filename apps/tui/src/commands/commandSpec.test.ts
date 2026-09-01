import test from 'node:test';
import assert from 'node:assert/strict';
import {
	COMMAND_SPECS,
	findCommandSpec,
	uiOnlyCommandNames,
	engineCommandNames,
	visibleCommandSpecs,
	commandSpecToInfo
} from './commandSpec.js';

test('command spec has unique primary names', () => {
	const names = visibleCommandSpecs().map(spec => spec.name);
	assert.equal(new Set(names).size, names.length);
});

test('aliases resolve to canonical spec', () => {
	assert.equal(findCommandSpec('reset')?.name, 'new');
	assert.equal(findCommandSpec('compress')?.name, 'compact');
	assert.equal(findCommandSpec('ctx')?.name, 'context');
	assert.equal(findCommandSpec('exit_plan')?.name, 'exit-plan');
	assert.equal(findCommandSpec('quit')?.name, 'exit');
});

test('ui-only commands are never engine-owned', () => {
	for (const name of uiOnlyCommandNames()) {
		const spec = findCommandSpec(name);
		assert.equal(spec?.owner, 'ui');
	}
});

test('hidden commands are excluded from visible list', () => {
	const hidden = COMMAND_SPECS.filter(spec => spec.availability === 'hidden').map(spec => spec.name);
	for (const name of hidden) {
		assert.ok(!visibleCommandSpecs().some(spec => spec.name === name));
	}
});

test('commandSpecToInfo preserves availability metadata', () => {
	const run = findCommandSpec('run');
	assert.ok(run);
	const info = commandSpecToInfo(run);
	assert.equal(info.availability, 'capability_unavailable');
	assert.equal(info.capability, 'clusterTaskExecution');
	assert.equal(info.available, false);
});

test('engine command names include hybrid commands', () => {
	assert.ok(engineCommandNames().includes('new'));
	assert.ok(engineCommandNames().includes('clear'));
	assert.ok(engineCommandNames().includes('rule'));
	assert.ok(!engineCommandNames().includes('help'));
});
