import test from 'node:test';
import assert from 'node:assert/strict';
import {latestActiveSession, resolveInkSessionConfig, resolveSessionArgs} from './sessionLaunch.js';

test('resolveSessionArgs defaults to continue', () => {
	assert.deepEqual(resolveSessionArgs({mode: 'continue'}, [], {}), ['--continue']);
});

test('resolveSessionArgs honors explicit new session', () => {
	assert.deepEqual(resolveSessionArgs({mode: 'new'}), ['--new']);
	assert.deepEqual(resolveSessionArgs(undefined, ['--new'], {}), ['--new']);
});

test('resolveSessionArgs honors resume id', () => {
	assert.deepEqual(resolveSessionArgs({mode: 'resume', sessionId: 'abc123'}), ['--resume', 'abc123']);
	assert.deepEqual(resolveSessionArgs(undefined, ['--resume', 'xyz'], {}), ['--resume', 'xyz']);
});

test('resolveInkSessionConfig defaults to continue', () => {
	assert.deepEqual(resolveInkSessionConfig([], {}), {mode: 'continue'});
});

test('resolveInkSessionConfig honors --new and FAST_SESSION', () => {
	assert.deepEqual(resolveInkSessionConfig(['--new'], {}), {mode: 'new'});
	assert.deepEqual(resolveInkSessionConfig(['-n'], {}), {mode: 'new'});
	assert.deepEqual(resolveInkSessionConfig([], {FAST_SESSION: 'new'}), {mode: 'new'});
});

test('resolveInkSessionConfig honors --resume and FAST_RESUME', () => {
	assert.deepEqual(resolveInkSessionConfig(['--resume', 's-9'], {}), {mode: 'resume', sessionId: 's-9'});
	assert.deepEqual(resolveInkSessionConfig([], {FAST_RESUME: ' s-8 '}), {mode: 'resume', sessionId: 's-8'});
});

test('latestActiveSession picks newest non-deleted row', () => {
	const latest = latestActiveSession([
		{id: 'old', status: 'active', updatedAt: '2026-01-01T00:00:00Z'},
		{id: 'gone', status: 'deleted', updatedAt: '2026-07-01T00:00:00Z'},
		{id: 'new', status: 'active', updatedAt: '2026-06-01T00:00:00Z'},
		{id: 'closed', status: 'closed', updatedAt: '2026-07-02T00:00:00Z'}
	]);
	assert.equal(latest?.id, 'new');
});

test('latestActiveSession returns undefined when none active', () => {
	assert.equal(latestActiveSession([{id: 'x', status: 'deleted'}]), undefined);
	assert.equal(latestActiveSession([]), undefined);
});
