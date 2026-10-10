import assert from 'node:assert/strict';
import test from 'node:test';
import type {ConfigurableTool} from '@fast-ide/session-view';
import {groupForTool, groupRows, toolsInGroup} from './toolGroups.js';

function named(name: string, group?: string): ConfigurableTool {
	return {
		name,
		titleKey: `tools.${name}.title`,
		summaryKey: `tools.${name}.summary`,
		status: 'active',
		fields: [],
		values: {},
		secrets: {},
		...(group === undefined ? {} : {group}),
	};
}

test('groupForTool renders only the wire-declared group', () => {
	assert.equal(groupForTool(named('deepseek_search', 'general')), 'general');
	assert.equal(groupForTool(named('generate_image', 'image')), 'image');
	assert.equal(groupForTool(named('generate_video', 'video')), 'video');
	assert.equal(groupForTool(named('tts', 'speech')), 'speech');
	assert.equal(groupForTool(named('custom_helper', 'other')), 'other');
});

test('groupForTool never guesses from the tool name', () => {
	assert.equal(groupForTool(named('deepseek_search')), 'other');
	assert.equal(groupForTool(named('generate_image')), 'other');
	assert.equal(groupForTool(named('tts', 'plumbing')), 'other');
});

test('groupRows keeps every group in order with its tools', () => {
	const tools = [
		named('deepseek_search', 'general'),
		named('generate_image', 'image'),
		named('generate_video', 'video'),
		named('tts', 'speech'),
		named('custom_helper', 'other'),
		named('mystery'),
	];
	const rows = groupRows(tools);
	assert.deepEqual(
		rows.map((row) => row.key),
		['general', 'image', 'video', 'speech', 'other'],
	);
	assert.deepEqual(
		rows.map((row) => row.tools.map((item) => item.name)),
		[['deepseek_search'], ['generate_image'], ['generate_video'], ['tts'], ['custom_helper', 'mystery']],
	);
	assert.deepEqual(groupRows([]).map((row) => row.key), ['general', 'image', 'video', 'speech', 'other']);
});

test('toolsInGroup filters a single group by wire group', () => {
	const tools = [named('generate_image', 'image'), named('custom_helper', 'other')];
	assert.deepEqual(toolsInGroup(tools, 'image').map((item) => item.name), ['generate_image']);
});
