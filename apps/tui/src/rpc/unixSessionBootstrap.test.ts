import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyUnixBootstrap, stepUnixBootstrap} from './unixSessionBootstrap.js';
import type {BridgeEvent} from './protocol.js';

const opts = {
	cwd: '/tmp/project',
	clientId: 'ink-1',
	sessionConfig: {mode: 'continue' as const},
	displayName: 'project'
};

function ready(sessionId = 'host-boot-sess'): BridgeEvent {
	return {
		type: 'ready',
		protocolVersion: 2,
		engineEpoch: 'e1',
		capabilities: [],
		model: 'm',
		maxTurns: 50,
		standalone: true,
		cwd: '/tmp',
		sessionId
	};
}

test('strips host boot sessionId from ready and sends EnsureProject once', () => {
	let boot = emptyUnixBootstrap();
	const a = stepUnixBootstrap(boot, ready(), opts);
	boot = a.bootstrap;
	assert.equal((a.forward as {sessionId?: string}).sessionId, undefined);
	assert.equal((a.forward as {cwd?: string}).cwd, undefined, 'must not adopt IDE ready cwd');
	assert.deepEqual(a.sends, [
		{
			type: 'EnsureProject',
			path: opts.cwd,
			projectType: 'coding',
			displayName: 'project'
		}
	]);
	const b = stepUnixBootstrap(boot, {type: 'HelloOk', protocolVersion: 1}, opts);
	assert.equal(b.sends.length, 0, 'EnsureProject only once');
});

test('continue: early workspace_meta (IDE fan-out) is consumed after EnsureProject', () => {
	let boot = emptyUnixBootstrap();
	boot = stepUnixBootstrap(boot, ready(), opts).bootstrap;

	// Meta arrives before EnsureProject command_result (race with IDE / prior fan-out).
	const earlyMeta = stepUnixBootstrap(
		boot,
		{
			type: 'workspace_meta',
			tenantId: 'default',
			appId: 'default',
			projects: [
				{
					id: 'proj-1',
					projectType: 'coding',
					displayName: 'nano',
					status: 'active',
					isDefault: false
				}
			],
			sessionsByProjectId: {
				'proj-1': [{id: 'sess-old', status: 'active', updatedAt: '2026-01-01T00:00:00Z'}]
			}
		},
		opts
	);
	boot = earlyMeta.bootstrap;
	assert.equal(earlyMeta.sends.length, 0, 'no pending continue yet');

	const ensured = stepUnixBootstrap(
		boot,
		{
			type: 'command_result',
			name: 'EnsureProject',
			status: 'accepted',
			message: 'reused',
			projectId: 'proj-1'
		},
		opts
	);
	assert.ok(
		ensured.sends.some(c => c.type === 'AttachSession' && c.sessionId === 'sess-old'),
		'must Attach using cached meta, not hang waiting for a second meta'
	);
	assert.equal(ensured.bootstrap.sessionBootstrapped, true);
});

test('continue: missing meta triggers GetWorkspaceMeta then CreateSession', () => {
	let boot = emptyUnixBootstrap();
	boot = stepUnixBootstrap(boot, ready(), opts).bootstrap;

	const ensured = stepUnixBootstrap(
		boot,
		{
			type: 'command_result',
			name: 'EnsureProject',
			status: 'accepted',
			message: 'created',
			projectId: 'proj-2'
		},
		opts
	);
	assert.deepEqual(ensured.sends, [{type: 'GetWorkspaceMeta'}]);
	boot = ensured.bootstrap;

	const meta = stepUnixBootstrap(
		boot,
		{
			type: 'workspace_meta',
			tenantId: 'default',
			appId: 'default',
			projects: [
				{
					id: 'proj-2',
					projectType: 'coding',
					displayName: 'nano',
					status: 'active',
					isDefault: false
				}
			],
			sessionsByProjectId: {'proj-2': []}
		},
		opts
	);
	assert.deepEqual(meta.sends, [{type: 'CreateSession', projectId: 'proj-2', title: 'project'}]);
});

test('new mode: EnsureProject → CreateSession → Attach on accept', () => {
	const newOpts = {...opts, sessionConfig: {mode: 'new' as const}};
	let boot = emptyUnixBootstrap();
	boot = stepUnixBootstrap(boot, ready(), newOpts).bootstrap;
	const ensured = stepUnixBootstrap(
		boot,
		{
			type: 'command_result',
			name: 'EnsureProject',
			status: 'accepted',
			message: 'ok',
			projectId: 'proj-n'
		},
		newOpts
	);
	assert.deepEqual(ensured.sends, [{type: 'CreateSession', projectId: 'proj-n', title: 'project'}]);
	boot = ensured.bootstrap;

	const created = stepUnixBootstrap(
		boot,
		{
			type: 'command_result',
			name: 'CreateSession',
			status: 'accepted',
			message: 'ok',
			sessionId: 'sess-n'
		},
		newOpts
	);
	assert.ok(created.sends.some(c => c.type === 'AttachSession' && c.sessionId === 'sess-n'));
});
