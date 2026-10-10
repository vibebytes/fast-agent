import assert from 'node:assert/strict';
import test from 'node:test';
import type {ConfigurableTool} from '@fast-ide/session-view';
import {groupForTool, groupRows, toolsInGroup} from './toolGroups.js';

function named(name: string): ConfigurableTool {
	return {
		name,
		titleKey: `tools.${name}.title`,
		summaryKey: `tools.${name}.summary`,
		status: 'active',
		fields: [],
		values: {},
		secrets: {},
	};
}

const tools: ConfigurableTool[] = [
	named('deepseek_search'),
	named('generate_image'),
	named('generate_video'),
	named('tts'),
	named('perplexity_search'),
	named('custom_helper'),
];

test('groupForTool buckets media tools and defaults to other', () => {
	assert.equal(groupForTool(named('deepseek_search')), 'general');
	assert.equal(groupForTool(named('perplexity_search')), 'general');
	assert.equal(groupForTool(named('generate_image')), 'image');
	assert.equal(groupForTool(named('generate_video')), 'video');
	assert.equal(groupForTool(named('tts')), 'speech');
	assert.equal(groupForTool(named('custom_helper')), 'other');
});

test('groupRows keeps every group in order with its tools', () => {
	const rows = groupRows(tools);
	assert.deepEqual(
		rows.map((row) => row.key),
		['general', 'image', 'video', 'speech', 'other'],
	);
	assert.deepEqual(
		rows.map((row) => row.tools.map((item) => item.name)),
		[['deepseek_search', 'perplexity_search'], ['generate_image'], ['generate_video'], ['tts'], ['custom_helper']],
	);
	assert.deepEqual(groupRows([]).map((row) => row.key), ['general', 'image', 'video', 'speech', 'other']);
});

test('toolsInGroup filters a single group', () => {
	assert.deepEqual(toolsInGroup(tools, 'image').map((item) => item.name), ['generate_image']);
});

test('a wire-declared group wins over the name heuristic', () => {
	assert.equal(groupForTool({...named('custom_helper'), group: 'image'}), 'image');
	assert.equal(groupForTool({...named('custom_helper'), group: 'speech'}), 'speech');
});

test('unknown wire groups fall back to the name heuristic', () => {
	assert.equal(groupForTool({...named('custom_helper'), group: 'plumbing'}), 'other');
	assert.equal(groupForTool({...named('tts'), group: 'plumbing'}), 'speech');
});
