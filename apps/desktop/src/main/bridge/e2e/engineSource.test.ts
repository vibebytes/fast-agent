import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {agentRepoRoot, fastRepoRoot, planEngineSource, stageCliFor, stageFreshness} from './engineSource.js';

test('repo roots resolve to real repos', () => {
	assert.equal(existsSync(path.join(fastRepoRoot, 'apps', 'desktop', 'package.json')), true, fastRepoRoot);
	assert.equal(existsSync(path.join(agentRepoRoot, 'build.sbt')), true, agentRepoRoot);
});

test('planEngineSource maps FAST_E2E_ENGINE values', () => {
	assert.equal(planEngineSource(undefined), 'placed');
	assert.equal(planEngineSource(''), 'placed');
	assert.equal(planEngineSource('placed'), 'placed');
	assert.equal(planEngineSource('stage'), 'stage');
	assert.equal(planEngineSource('/tmp/agent-dist'), 'dir');
	assert.equal(planEngineSource('dist'), 'dir');
});

test('stageFreshness compares newest source mtime against newest staged jar', () => {
	assert.equal(stageFreshness([100], undefined), 'missing');
	assert.equal(stageFreshness([100], []), 'missing');
	assert.equal(stageFreshness([100], [200, 300]), 'fresh');
	assert.equal(stageFreshness([100, 400], [200, 300]), 'stale');
	assert.equal(stageFreshness([], [200]), 'fresh');
	assert.equal(stageFreshness([300], [300]), 'fresh');
});

test('stageCliFor points at the sbt stage launcher', () => {
	assert.equal(stageCliFor('/agent'), '/agent/modules/cli/cli/target/universal/stage/bin/fast-cli');
});
