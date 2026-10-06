import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	clusterHome,
	loadClusterHomes,
	parseClusterHomes,
	pinClusterHome,
	saveClusterHomes,
	clusterHomesPath
} from './clusterHomes.js';

test('homes are keyed by agent id and a second individual does not replace the first', () => {
	const homes = pinClusterHome(
		pinClusterHome(
			{},
			{edgeId: 'individual:a', agentId: 'a', projectId: 'default-project', sessionId: 'sess-a'}
		),
		{edgeId: 'individual:b', agentId: 'b', projectId: 'default-project', sessionId: 'sess-b'}
	);
	assert.equal(clusterHome(homes, 'a')?.sessionId, 'sess-a');
	assert.equal(clusterHome(homes, 'b')?.sessionId, 'sess-b');
	assert.equal(clusterHome(homes, 'missing'), undefined);
});

test('a broken homes file reads as empty and a round trip keeps both rows', () => {
	assert.deepEqual(parseClusterHomes('not-json'), {});
	assert.deepEqual(parseClusterHomes('[]'), {});
	const dir = mkdtempSync(path.join(tmpdir(), 'cluster-homes-'));
	const file = clusterHomesPath(dir);
	const homes = pinClusterHome(
		{},
		{edgeId: 'local', agentId: 'self', projectId: 'default-project', sessionId: 'sess-self'}
	);
	saveClusterHomes(file, homes);
	assert.equal(loadClusterHomes(file).self?.sessionId, 'sess-self');
	assert.equal(loadClusterHomes(path.join(dir, 'missing.json')).self, undefined);
});
