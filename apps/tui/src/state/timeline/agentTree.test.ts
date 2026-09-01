import test from 'node:test';
import assert from 'node:assert/strict';
import {agentCallItems} from './agentTree.js';
import type {AgentRun} from '../model.js';

function run(overrides: Partial<AgentRun> & {runId: string}): AgentRun {
	return {
		agentId: overrides.runId,
		depth: 1,
		name: overrides.runId,
		status: 'running',
		startedAt: 1000,
		toolCalls: 0,
		...overrides
	};
}

test('a single delegation renders flat: no trunk, no tree prefix', () => {
	const items = agentCallItems([run({runId: 'run-a', name: 'researcher'})]);
	assert.equal(items.length, 1);
	assert.equal(items[0]?.id, 'agent-run-a');
	assert.equal(items[0]?.treePrefix, '');
	assert.equal(items[0]?.trunk, undefined);
	assert.equal(items[0]?.pending, true);
});

test('concurrent siblings render under a trunk row with tree connectors', () => {
	const items = agentCallItems([
		run({runId: 'run-a', name: 'researcher'}),
		run({runId: 'run-b', name: 'reviewer', batchId: 'run-a', status: 'success'})
	]);
	assert.equal(items.length, 3);

	const trunk = items[0]!;
	assert.equal(trunk.id, 'agent-trunk-run-a');
	assert.deepEqual(trunk.trunk, {total: 2, running: 1, failed: 0});
	assert.equal(trunk.status, 'running');

	assert.equal(items[1]?.treePrefix, '├─ ');
	assert.equal(items[2]?.treePrefix, '└─ ');
	assert.equal(items[2]?.summaryIndent, '   ');
	// One member still running → the WHOLE batch stays pending (settles as a unit).
	assert.ok(items.every(item => item.pending === true));
});

test('a fully terminal batch settles as a unit', () => {
	const items = agentCallItems([
		run({runId: 'run-a', status: 'success', elapsedMs: 1200, tokensUsed: 300}),
		run({runId: 'run-b', batchId: 'run-a', status: 'failed', elapsedMs: 900, tokensUsed: 200})
	]);
	assert.ok(items.every(item => item.pending === undefined));
	const trunk = items[0]!;
	assert.equal(trunk.status, 'failed', 'any failed sibling marks the trunk');
	assert.equal(trunk.tokensUsed, 500, 'trunk aggregates member tokens');
});

test('nested delegations hang under their parent with continuation lines', () => {
	const items = agentCallItems([
		run({runId: 'run-a', name: 'researcher'}),
		run({runId: 'run-b', name: 'reviewer', batchId: 'run-a'}),
		run({runId: 'run-nested', name: 'sentiment', batchId: 'run-a', parentRunId: 'run-a', depth: 2})
	]);
	// trunk, run-a, run-a's child, run-b — children stay attached to their parent.
	assert.deepEqual(items.map(item => item.id),
		['agent-trunk-run-a', 'agent-run-a', 'agent-run-nested', 'agent-run-b']);
	assert.equal(items[2]?.treePrefix, '│  └─ ');
});

test('separate batches stay independent: a settled batch is not re-opened', () => {
	const items = agentCallItems([
		run({runId: 'run-a', status: 'success'}),
		run({runId: 'run-c', status: 'running'})
	]);
	assert.equal(items[0]?.pending, undefined, 'terminal solo batch settles');
	assert.equal(items[1]?.pending, true);
});
