/** protocol.test — host. Loaded by protocol.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeEventSchema, bridgeCommandSchema, isLiveChrome, parseBridgeCommand, pickIdList, wireIdList} from '../protocol.js';

test('bridgeEventSchema accepts GetBridgePairing command_result pairing payload', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'GetBridgePairing',
		message: 'ok',
		status: 'success',
		pairing: {
			available: true,
			host: '192.168.1.8',
			port: 1979,
			serverUrl: 'wss://192.168.1.8:1979/bridge',
			token: 'tok',
			fingerprint: 'sha256:' + 'ab'.repeat(32),
			pairUri: 'fast-bridge://pair?url=x&token=y&fingerprint=z'
		}
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.pairing?.available, true);
		assert.equal(parsed.pairing?.port, 1979);
		assert.equal(parsed.pairing?.reason, undefined);
	}
	const off = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'GetBridgePairing',
		message: 'NoWss',
		status: 'success',
		pairing: {available: false, reason: 'no_wss'}
	});
	assert.equal(off.type, 'command_result');
	if (off.type === 'command_result') {
		assert.equal(off.pairing?.available, false);
		assert.equal(off.pairing?.reason, 'no_wss');
	}
});

test('bridgeEventSchema accepts workspace_meta with Default Project and empty sessions', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [{
			id: 'default-project',
			projectType: 'general',
			displayName: 'Default Project',
			status: 'active',
			isDefault: true,
			workspace: null
		}],
		sessionsByProjectId: {}
	});
	assert.equal(parsed.type, 'workspace_meta');
	if (parsed.type === 'workspace_meta') {
		assert.equal(parsed.projects[0]?.id, 'default-project');
		assert.equal(parsed.projects[0]?.isDefault, true);
		assert.deepEqual(parsed.sessionsByProjectId, {});
	}
});

test('bridgeCommandSchema round-trips Meta host commands', () => {
	const cases = [
		{type: 'GetWorkspaceMeta'},
		{type: 'GetWorkspaceMeta', tenantId: 'default', appId: 'default-app'},
		{type: 'CreateProject', projectType: 'coding', rootPath: '/tmp/p', displayName: 'P'},
		{type: 'CreateSession', projectId: 'default-project', title: 'Task', startupMode: 'plan', taskId: 'task-1'},
		{type: 'UpdateProjectStatus', projectId: 'p1', status: 'closed'},
		{type: 'SetProjectDisplayName', projectId: 'p1', displayName: 'Renamed'}
	] as const;

	for (const cmd of cases) {
		const parsed = parseBridgeCommand(cmd);
		assert.equal(parsed.type, cmd.type);
		const again = bridgeCommandSchema.parse(JSON.parse(JSON.stringify(parsed)));
		assert.equal(again.type, cmd.type);
	}
});

test('bridgeCommandSchema rejects unknown Meta-ish types', () => {
	assert.throws(() => parseBridgeCommand({type: 'GetWorkspaceMetaX'}));
});

test('bridgeCommandSchema accepts Hello / EnsureProject / ClientHeartbeat / Shutdown', () => {
	const hello = bridgeCommandSchema.parse({
		type: 'Hello',
		protocolVersion: 1,
		clientId: 'fast-ink-1',
		clientKind: 'fast-ink',
		cwd: '/tmp/ws',
		authToken: 'tok',
		pid: 42
	});
	assert.equal(hello.type, 'Hello');

	const ensure = bridgeCommandSchema.parse({
		type: 'EnsureProject',
		path: '/tmp/ws',
		projectType: 'coding'
	});
	assert.equal(ensure.type, 'EnsureProject');

	const hb = bridgeCommandSchema.parse({
		type: 'ClientHeartbeat',
		clientId: 'fast-ink-1',
		atMillis: 1
	});
	assert.equal(hb.type, 'ClientHeartbeat');

	const shutdown = bridgeCommandSchema.parse({type: 'Shutdown', force: false});
	assert.equal(shutdown.type, 'Shutdown');

	const status = bridgeCommandSchema.parse({type: 'GetDaemonStatus'});
	assert.equal(status.type, 'GetDaemonStatus');

	const pairing = bridgeCommandSchema.parse({type: 'GetBridgePairing'});
	assert.equal(pairing.type, 'GetBridgePairing');

	const setPairing = bridgeCommandSchema.parse({type: 'SetLanPairing', enabled: true});
	assert.equal(setPairing.type, 'SetLanPairing');
	assert.equal(setPairing.enabled, true);

	const bye = bridgeCommandSchema.parse({type: 'Goodbye', clientId: 'c1', reason: 'client_exit'});
	assert.equal(bye.type, 'Goodbye');
});

test('bridgeEventSchema accepts HelloOk / HelloReject / daemon_shutting_down', () => {
	const ok = bridgeEventSchema.parse({
		type: 'HelloOk',
		protocolVersion: 1,
		engineEpoch: 'e1',
		daemonPid: 9,
		serverTimeMillis: 1,
		engineId: '0.3.1 temurin-17-darwin-arm64 2026-09-02T08:50:00.000Z'
	});
	assert.equal(ok.type, 'HelloOk');
	if (ok.type === 'HelloOk') assert.equal(ok.engineId?.startsWith('0.3.1 '), true);

	const reject = bridgeEventSchema.parse({
		type: 'HelloReject',
		code: 'UNAUTHORIZED',
		message: 'bad token'
	});
	assert.equal(reject.type, 'HelloReject');

	const down = bridgeEventSchema.parse({type: 'daemon_shutting_down'});
	assert.equal(down.type, 'daemon_shutting_down');
});
