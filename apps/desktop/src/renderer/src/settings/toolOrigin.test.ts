import assert from 'node:assert/strict';
import test from 'node:test';
import type {ConfigurableTool} from '@fast-ide/session-view';
import {byOrigin, needsForm, originLabelKey, originOf, toggleSave, toolSummary, toolTitle} from './toolOrigin.js';

function named(name: string, extra: Partial<ConfigurableTool> = {}): ConfigurableTool {
	return {
		name,
		titleKey: `tools.${name}.title`,
		summaryKey: `tools.${name}.summary`,
		status: 'active',
		fields: [],
		values: {},
		secrets: {},
		...extra,
	};
}

test('originOf treats a missing origin as builtin', () => {
	assert.equal(originOf(named('read_file')), 'builtin');
	assert.equal(originOf(named('clock_now', {origin: 'external'})), 'external');
});

test('originLabelKey points at the origin copy', () => {
	assert.equal(originLabelKey(named('read_file')), 'settings.plugins.tools.origin.builtin');
	assert.equal(originLabelKey(named('clock_now', {origin: 'external'})), 'settings.plugins.tools.origin.external');
});

test('toolTitle and toolSummary fall back from keys to text to the name', () => {
	const t = (key: string) => `t:${key}`;
	assert.equal(toolTitle(named('read_file'), t), 't:tools.read_file.title');
	assert.equal(toolTitle(named('clock_now', {titleKey: '', title: 'Clock now'}), t), 'Clock now');
	assert.equal(toolTitle(named('bare', {titleKey: ''}), t), 'bare');
	assert.equal(toolSummary(named('read_file'), t), 't:tools.read_file.summary');
	assert.equal(toolSummary(named('clock_now', {summaryKey: '', summary: 'Now.'}), t), 'Now.');
	assert.equal(toolSummary(named('bare', {summaryKey: ''}), t), '');
});

test('byOrigin keeps builtins first and groups externals by extension', () => {
	const tools = [
		named('z', {origin: 'external', extension: 'b', titleKey: ''}),
		named('y'),
		named('x', {origin: 'external', extension: 'a', titleKey: ''}),
		named('w'),
	];
	assert.deepEqual(byOrigin(tools).map(tool => tool.name), ['y', 'w', 'x', 'z']);
});

test('needsForm is false when the tool declares no fields', () => {
	assert.equal(needsForm(named('clock_now')), false);
	assert.equal(needsForm(named('quote', {fields: [{key: 'apiKey', type: 'secret', required: true}]})), true);
});

test('toggleSave is the same payload for enable and disable', () => {
	assert.deepEqual(toggleSave(named('clock_now'), true), {
		name: 'clock_now',
		enabled: true,
		values: {},
		secrets: {},
		clearSecrets: []
	});
	assert.deepEqual(toggleSave(named('clock_now'), false).enabled, false);
});
