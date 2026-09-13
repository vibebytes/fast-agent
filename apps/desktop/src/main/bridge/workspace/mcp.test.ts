import assert from 'node:assert/strict';
import test from 'node:test';
import {createMcp, mcpTimeout} from './mcp.js';
import type {CommandResult, HostLane} from './hostWait.js';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';

type WaitCall = {names: string[]; timeoutMs?: number};

function resultEvent(name: string, patch: Partial<Extract<BridgeEvent, {type: 'command_result'}>> = {}) {
	return {
		type: 'command_result',
		name,
		message: '',
		status: 'success',
		...patch
	} as CommandResult;
}

function laneOf(reply: (cmd: BridgeCommand) => CommandResult | null, sendOk = true) {
	const waits: WaitCall[] = [];
	const sent: string[] = [];
	const sentCmds: BridgeCommand[] = [];
	let ready = true;
	let pending: ((event: CommandResult) => void) | null = null;
	let pendingReject: ((err: Error) => void) | null = null;
	const lane: HostLane = {
		ready: () => ready,
		wait: (names, _metaId, timeoutMs) => {
			waits.push({names, timeoutMs});
			const promise = new Promise<CommandResult>((resolve, reject) => {
				pending = resolve;
				pendingReject = reject;
			});
			promise.catch(() => {});
			return {token: 't', promise};
		},
		waitRequest: () => ({token: 'r', promise: new Promise<CommandResult>(() => {})}),
		send: cmd => {
			sentCmds.push(cmd);
			sent.push(String((cmd as {type: string}).type));
			if (!sendOk) return false;
			const event = reply(cmd);
			if (event) pending?.(event);
			return true;
		},
		cancel: () => {
			pendingReject?.(new Error('send failed'));
			pendingReject = null;
		},
		metaId: () => undefined,
		displayName: () => undefined
	};
	return {
		lane,
		waits,
		sent,
		sentCmds,
		setReady: (v: boolean) => {
			ready = v;
		}
	};
}

const oneRow = {
	name: 'filesystem',
	transport: 'stdio',
	command: 'npx',
	args: ['-y', 'server-filesystem'],
	enabled: true,
	state: 'running',
	pid: 42
};

test('mcpTimeout maps fast/slow planes', () => {
	assert.equal(mcpTimeout('fast'), 12_000);
	assert.equal(mcpTimeout('slow'), 30_000);
});

test('listMcpServers sends ListMcpServers on the fast plane and returns rows', async () => {
	const {lane, waits, sent} = laneOf(cmd =>
		String((cmd as {type: string}).type) === 'ListMcpServers'
			? resultEvent('ListMcpServers', {mcpServers: [oneRow]})
			: null
	);
	const r = await createMcp(lane).listMcpServers();
	assert.ok(r.ok);
	assert.deepEqual(r.mcpServers, [oneRow]);
	assert.deepEqual(sent, ['ListMcpServers']);
	assert.equal(waits[0]?.timeoutMs, 12_000);
});

test('listMcpServers tolerates non-array payload and engine-not-ready', async () => {
	const {lane, setReady} = laneOf(() => resultEvent('ListMcpServers'));
	const empty = await createMcp(lane).listMcpServers();
	assert.ok(empty.ok && empty.mcpServers.length === 0);
	setReady(false);
	const down = await createMcp(lane).listMcpServers();
	assert.deepEqual(down, {ok: false, notice: 'Engine not ready'});
});

test('listMcpServers surfaces engine error message as notice', async () => {
	const {lane} = laneOf(() => resultEvent('ListMcpServers', {status: 'error', message: 'engine offline'}));
	const r = await createMcp(lane).listMcpServers();
	assert.deepEqual(r, {ok: false, notice: 'engine offline'});
});

test('mcpServerControl forwards name/op and unwraps the control payload', async () => {
	const {lane, sent, sentCmds} = laneOf(cmd => {
		const c = cmd as {type: string; name?: string; op?: string};
		if (c.type === 'McpServerControl') {
			return resultEvent('McpServerControl', {
				mcp: {ok: true, name: c.name!, op: c.op!, state: 'running', pid: 7, restarts: 0}
			});
		}
		return null;
	});
	const r = await createMcp(lane).mcpServerControl('filesystem', 'restart');
	assert.ok(r.ok);
	assert.equal(r.mcp.state, 'running');
	assert.deepEqual(sent, ['McpServerControl']);
	assert.deepEqual(sentCmds, [{type: 'McpServerControl', name: 'filesystem', op: 'restart'}]);
});

test('mcpServerControl rejects rejected status and missing payload', async () => {
	const {lane} = laneOf(() => resultEvent('McpServerControl', {status: 'rejected', message: 'busy'}));
	const busy = await createMcp(lane).mcpServerControl('fs', 'stop');
	assert.deepEqual(busy, {ok: false, notice: 'busy'});
	const noPayload = await createMcp(laneOf(() => resultEvent('McpServerControl')).lane).mcpServerControl(
		'fs',
		'stop'
	);
	assert.equal(noPayload.ok, false);
});

test('mcpServerPut/Enabled/Delete round-trip on the fast plane', async () => {
	const {lane, sent, sentCmds} = laneOf(cmd => {
		const type = String((cmd as {type: string}).type);
		if (type === 'McpServerDelete') return resultEvent(type);
		return resultEvent(type, {mcpServers: [oneRow]});
	});
	const mcp = createMcp(lane);
	const put = await mcp.mcpServerPut('filesystem', {transport: 'stdio', command: 'npx'});
	assert.ok(put.ok && put.mcpServers[0]?.name === 'filesystem');
	const enabled = await mcp.mcpServerEnabled('filesystem', false);
	assert.ok(enabled.ok && enabled.mcpServers[0]?.enabled === true);
	const del = await mcp.mcpServerDelete('filesystem');
	assert.deepEqual(del, {ok: true});
	assert.deepEqual(sent, ['McpServerPut', 'McpServerEnabled', 'McpServerDelete']);
	assert.deepEqual(sentCmds, [
		{type: 'McpServerPut', name: 'filesystem', config: {transport: 'stdio', command: 'npx'}},
		{type: 'McpServerEnabled', name: 'filesystem', enabled: false},
		{type: 'McpServerDelete', name: 'filesystem'}
	]);
});

test('mcpConfigImport/Reload use the slow 30s plane', async () => {
	const {lane, waits, sentCmds} = laneOf(cmd =>
		resultEvent(String((cmd as {type: string}).type), {mcpServers: [oneRow]})
	);
	const mcp = createMcp(lane);
	const payload = {
		mcpServers: {blender: {command: 'uvx', args: ['blender-mcp'], transport: 'stdio'}}
	};
	const imported = await mcp.mcpConfigImport(payload);
	assert.ok(imported.ok && imported.mcpServers.length === 1);
	const reloaded = await mcp.mcpConfigReload();
	assert.ok(reloaded.ok);
	assert.deepEqual(sentCmds, [
		{type: 'McpConfigImport', payload},
		{type: 'McpConfigReload'}
	]);
	assert.deepEqual(
		waits.map(w => w.timeoutMs),
		[30_000, 30_000]
	);
});

test('send failure yields a notice instead of throwing', async () => {
	const {lane, sent} = laneOf(() => null, false);
	const r = await createMcp(lane).listMcpServers();
	assert.deepEqual(r, {ok: false, notice: 'Failed to send ListMcpServers'});
	assert.deepEqual(sent, ['ListMcpServers']);
});
