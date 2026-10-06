import assert from 'node:assert/strict';
import test from 'node:test';
import {clusterNodeName} from './clusterNodeName.js';

test('clusterNodeName is empty off a cluster edge', () => {
	assert.equal(clusterNodeName('edge-1', [{self: true, displayName: '小A'}]), undefined);
	assert.equal(clusterNodeName(null, []), undefined);
});

test('clusterNodeName uses the local self displayName', () => {
	assert.equal(
		clusterNodeName('local', [
			{id: 'b', displayName: '小B'},
			{id: 'a', displayName: '小A', self: true}
		]),
		'小A'
	);
	assert.equal(clusterNodeName('local', []), undefined);
});

test('clusterNodeName resolves an individual edge from the roster', () => {
	assert.equal(
		clusterNodeName('individual:b', [
			{id: 'a', displayName: '小A', self: true},
			{agentId: 'b', displayName: '小B'}
		]),
		'小B'
	);
	assert.equal(clusterNodeName('individual:b', []), 'b');
});
