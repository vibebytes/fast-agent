import test from 'node:test';
import assert from 'node:assert/strict';
import type {TimelineItem} from '../timeline.js';
import {pushToolItem} from './convert.js';

type ToolItem = Extract<TimelineItem, {kind: 'tool'}>;

test('pushToolItem carries the delegation agentRunId onto the tool item', () => {
	const items: TimelineItem[] = [];
	pushToolItem(items, {
		id: 't1',
		tool: 'agent',
		status: 'running',
		agentRunId: 'run-a'
	});
	const item = items[0] as ToolItem;
	assert.equal(item.kind, 'tool');
	assert.equal(item.agentRunId, 'run-a');
});

test('pushToolItem omits agentRunId for plain tool rows', () => {
	const items: TimelineItem[] = [];
	pushToolItem(items, {id: 't2', tool: 'shell', status: 'success', output: 'ok'});
	const item = items[0] as ToolItem;
	assert.equal(item.agentRunId, undefined);
	assert.ok(!('agentRunId' in item));
});
