import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';
import type {McpControlResult, McpServerOp, McpServerRow} from '@fastllm/bridge-client';
import {mcpStore, mcpNoticeKind, parseImportPayload} from './useMcpServers.js';

type ListOk = {ok: true; mcpServers: McpServerRow[]};
type Err = {ok: false; notice: string};

function server(name: string, extra: Partial<McpServerRow> = {}): McpServerRow {
	return {name, enabled: true, ...extra};
}

function controlResult(extra: Partial<McpControlResult> = {}): McpControlResult {
	return {ok: true, name: 'probe', op: 'start', state: 'Running', ...extra};
}

function api(opts: {
	list?: () => Promise<ListOk | Err>;
	control?: (name: string, op: McpServerOp) => Promise<{ok: true; mcp: McpControlResult} | Err>;
	put?: (name: string, config: unknown) => Promise<ListOk | Err>;
	enabled?: (name: string, v: boolean) => Promise<ListOk | Err>;
	remove?: (name: string) => Promise<{ok: true} | Err>;
	import?: (payload: unknown) => Promise<ListOk | Err>;
	reload?: () => Promise<ListOk | Err>;
}) {
	return {
		listMcpServers: opts.list ?? (async () => ({ok: true as const, mcpServers: []})),
		mcpServerControl: opts.control ?? (async () => ({ok: true as const, mcp: controlResult()})),
		mcpServerPut: opts.put ?? (async () => ({ok: true as const, mcpServers: []})),
		mcpServerEnabled: opts.enabled ?? (async () => ({ok: true as const, mcpServers: []})),
		mcpServerDelete: opts.remove ?? (async () => ({ok: true as const})),
		mcpConfigImport: opts.import ?? (async () => ({ok: true as const, mcpServers: []})),
		mcpConfigReload: opts.reload ?? (async () => ({ok: true as const, mcpServers: []}))
	};
}

beforeEach(() => {
	mcpStore.resetForTest();
});

test('parseImportPayload normalizes ecosystem wrappers', () => {
	const wrapped = parseImportPayload('{"mcpServers":{"probe":{"command":"uvx"}}}');
	assert.equal(wrapped.ok, true);
	if (wrapped.ok) {
		assert.deepEqual(wrapped.payload, {mcpServers: {probe: {command: 'uvx'}}});
		assert.equal(wrapped.count, 1);
	}
	assert.deepEqual(parseImportPayload('{"servers":{"a":{"url":"http://x"}}}').payload, {
		mcpServers: {a: {url: 'http://x'}}
	});
	assert.deepEqual(parseImportPayload('{"probe":{"command":"node","args":["-y"]}}').payload, {
		mcpServers: {probe: {command: 'node', args: ['-y']}}
	});
});

test('parseImportPayload rejects junk', () => {
	assert.equal(parseImportPayload('not json').ok, false);
	assert.equal(parseImportPayload('[]').ok, false);
	assert.equal(parseImportPayload('{"mcpServers":{}}').ok, false);
	assert.equal(parseImportPayload('{"enabled":true}').ok, false);
	assert.equal(parseImportPayload('{"claude":{"projects":{}}}').ok, false);
});

test('mcpNoticeKind mapping', () => {
	assert.equal(mcpNoticeKind('restart required'), 'NeedsRestart');
	assert.equal(mcpNoticeKind('Busy'), 'Busy');
	assert.equal(mcpNoticeKind('invalid server config: x'), 'InvalidJson');
	assert.equal(mcpNoticeKind('denied'), 'Denied');
	assert.equal(mcpNoticeKind('engine admin not ready'), 'EngineDown');
	assert.equal(mcpNoticeKind('weird'), 'Unknown');
});

test('engine not ready is disabled and list keeps disabled', async () => {
	mcpStore.bindApi(api({}));
	mcpStore.setEngineReady(false);
	assert.equal(mcpStore.getSnapshot().status, 'disabled');
	await mcpStore.list();
	assert.equal(mcpStore.getSnapshot().status, 'disabled');
});

test('list error sets error status with notice', async () => {
	mcpStore.bindApi(api({list: async () => ({ok: false, notice: 'bridge down'})}));
	mcpStore.setEngineReady(true);
	await mcpStore.list();
	assert.equal(mcpStore.getSnapshot().status, 'error');
	assert.equal(mcpStore.getSnapshot().notice, 'bridge down');
});

test('list ready sorts servers and clears notice', async () => {
	mcpStore.bindApi(api({list: async () => ({ok: true, mcpServers: [server('zeta'), server('alpha')]})}));
	mcpStore.setEngineReady(true);
	await mcpStore.list();
	const view = mcpStore.getSnapshot();
	assert.equal(view.status, 'ready');
	assert.deepEqual(view.servers.map(s => s.name), ['alpha', 'zeta']);
});

test('control ok surfaces message and restart-required refreshes list', async () => {
	let lists = 0;
	let sawOp: McpServerOp | null = null;
	mcpStore.bindApi(
		api({
			list: async () => {
				lists += 1;
				return {ok: true, mcpServers: [server('probe')]};
			},
			control: async (_name, op) => {
				sawOp = op;
				return {ok: true, mcp: controlResult({op, message: 'started', restartRequired: true})};
			}
		})
	);
	mcpStore.setEngineReady(true);
	const done = await mcpStore.control('probe', 'start');
	assert.equal(done, true);
	assert.equal(sawOp, 'start');
	assert.equal(lists, 2);
	assert.equal(mcpNoticeKind(mcpStore.getSnapshot().notice ?? ''), 'NeedsRestart');
});

test('control failure sets notice', async () => {
	mcpStore.bindApi(api({control: async () => ({ok: false, notice: 'Busy'})}));
	mcpStore.setEngineReady(true);
	const done = await mcpStore.control('probe', 'stop');
	assert.equal(done, false);
	assert.equal(mcpNoticeKind(mcpStore.getSnapshot().notice ?? ''), 'Busy');
});

test('save ok updates rows', async () => {
	mcpStore.bindApi(api({put: async () => ({ok: true, mcpServers: [server('fresh')]})}));
	mcpStore.setEngineReady(true);
	const done = await mcpStore.save('fresh', {command: 'uvx'});
	assert.equal(done, true);
	assert.deepEqual(mcpStore.getSnapshot().servers.map(s => s.name), ['fresh']);
});

test('toggle optimistic update then confirmed rows with restart notice', async () => {
	mcpStore.bindApi(
		api({
			list: async () => ({ok: true, mcpServers: [server('probe', {enabled: true})]}),
			enabled: async () => ({ok: true, mcpServers: [server('probe', {enabled: false, restartRequired: true})]})
		})
	);
	mcpStore.setEngineReady(true);
	await mcpStore.list();
	const done = await mcpStore.toggle('probe', false);
	assert.equal(done, true);
	const view = mcpStore.getSnapshot();
	assert.equal(view.servers[0]!.enabled, false);
	assert.equal(view.noticeKind, 'NeedsRestart');
});

test('toggle failure restores previous value', async () => {
	mcpStore.bindApi(
		api({
			list: async () => ({ok: true, mcpServers: [server('probe', {enabled: true})]}),
			enabled: async () => ({ok: false, notice: 'denied'})
		})
	);
	mcpStore.setEngineReady(true);
	await mcpStore.list();
	const done = await mcpStore.toggle('probe', false);
	assert.equal(done, false);
	assert.equal(mcpStore.getSnapshot().servers[0]!.enabled, true);
});

test('remove drops row and refreshes', async () => {
	let deleted = false;
	mcpStore.bindApi(
		api({
			list: async () => ({ok: true, mcpServers: deleted ? [] : [server('probe')]}),
			remove: async () => {
				deleted = true;
				return {ok: true};
			}
		})
	);
	mcpStore.setEngineReady(true);
	await mcpStore.list();
	const done = await mcpStore.remove('probe');
	assert.equal(done, true);
	assert.equal(mcpStore.getSnapshot().servers.length, 0);
});

test('import ok updates rows', async () => {
	mcpStore.bindApi(api({import: async payload => ({ok: true, mcpServers: [server(String((payload as {mcpServers: Record<string, unknown>}).mcpServers['x'] ?? 'x'))]})}));
	mcpStore.setEngineReady(true);
	const done = await mcpStore.importServers({mcpServers: {x: {command: 'node'}}});
	assert.equal(done, true);
	assert.equal(mcpStore.getSnapshot().servers.length, 1);
});

test('reload failure sets notice', async () => {
	mcpStore.bindApi(api({reload: async () => ({ok: false, notice: 'invalid yaml'})}));
	mcpStore.setEngineReady(true);
	const done = await mcpStore.reload();
	assert.equal(done, false);
	assert.equal(mcpNoticeKind(mcpStore.getSnapshot().notice ?? ''), 'InvalidJson');
});
