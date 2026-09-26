import assert from 'node:assert/strict';
import {beforeEach, mock, test} from 'node:test';
import type {McpControlResult, McpServerOp, McpServerRow} from '@fastllm/bridge-client';
import {mcpStore, mcpNoticeKind, parseImportPayload} from './useMcpServers.js';
import {rowState} from './McpServerCard.js';

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

const blenderClineSettings = JSON.stringify({
	mcpServers: {
		blender: {
			command: 'uvx',
			args: ['blender-mcp'],
			env: {},
			disabled: false,
			autoApprove: ['execute_blender_code', 'get_scene_info', 'get_object_info', 'get_viewport_screenshot']
		}
	}
});

test('imports the real blender-mcp cline_mcp_settings.json from its README', () => {
	const res = parseImportPayload(blenderClineSettings);
	assert.equal(res.ok, true);
	if (res.ok) {
		assert.equal(res.count, 1);
		assert.deepEqual(res.payload.mcpServers.blender, {
			command: 'uvx',
			args: ['blender-mcp'],
			env: {},
			enabled: true
		});
	}
});

test('imports the blender export that failed with "unknown field transport"', () => {
	const res = parseImportPayload(
		'{"mcpServers":{"blender":{"command":"uvx","args":["blender-mcp"],"transport":"stdio","env":{},"disabled":false,"autoApprove":["execute_blender_code"]}}}'
	);
	assert.equal(res.ok, true);
	if (res.ok) {
		assert.deepEqual(res.payload.mcpServers.blender, {
			command: 'uvx',
			args: ['blender-mcp'],
			transport: 'stdio',
			env: {},
			enabled: true
		});
	}
});

test('imports a real claude_desktop_config.json unchanged', () => {
	const res = parseImportPayload(
		JSON.stringify({
			mcpServers: {
				filesystem: {
					command: 'npx',
					args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/username/Desktop']
				},
				github: {
					command: 'npx',
					args: ['-y', '@modelcontextprotocol/server-github'],
					env: {GITHUB_PERSONAL_ACCESS_TOKEN: '<YOUR_TOKEN>'}
				}
			}
		})
	);
	assert.equal(res.ok, true);
	if (res.ok) {
		assert.equal(res.count, 2);
		assert.deepEqual(res.payload.mcpServers.filesystem, {
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/username/Desktop']
		});
		assert.deepEqual(res.payload.mcpServers.github, {
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-github'],
			env: {GITHUB_PERSONAL_ACCESS_TOKEN: '<YOUR_TOKEN>'}
		});
	}
});

test('imports the VS Code mcp.json shape (servers wrapper, type stdio)', () => {
	const res = parseImportPayload(
		JSON.stringify({
			servers: {
				memory: {
					type: 'stdio',
					command: 'npx',
					args: ['-y', '@modelcontextprotocol/server-memory']
				}
			}
		})
	);
	assert.equal(res.ok, true);
	if (res.ok) {
		assert.deepEqual(res.payload.mcpServers.memory, {
			type: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-memory']
		});
	}
});

test('imports real remote SSE entries and hand-edited string args', () => {
	const sentry = parseImportPayload('{"mcpServers":{"sentry":{"transport":"sse","url":"https://mcp.sentry.dev/sse"}}}');
	assert.equal(sentry.ok, true);
	if (sentry.ok) {
		assert.deepEqual(sentry.payload.mcpServers.sentry, {transport: 'sse', url: 'https://mcp.sentry.dev/sse'});
	}
	const gmail = parseImportPayload(
		'{"mcpServers":{"gmail":{"command":"npx","args":"-y @gongrzhe/server-gmail-autoauth-mcp"}}}'
	);
	assert.equal(gmail.ok, true);
	if (gmail.ok) {
		assert.deepEqual(gmail.payload.mcpServers.gmail, {
			command: 'npx',
			args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp']
		});
	}
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

test('control success re-lists and does not surface restart-requested copy', async () => {
	let lists = 0;
	mcpStore.bindApi(
		api({
			list: async () => {
				lists += 1;
				return {ok: true, mcpServers: [server('blender', {state: lists === 1 ? 'starting' : 'running', pid: 1})]};
			},
			control: async () => ({
				ok: true,
				mcp: controlResult({
					op: 'restart',
					state: 'running',
					message: 'restart requested (state=running)'
				})
			})
		})
	);
	mcpStore.setEngineReady(true);
	const done = await mcpStore.control('blender', 'restart');
	assert.equal(done, true);
	assert.equal(lists, 2);
	assert.equal(mcpStore.getSnapshot().notice, null);
	assert.equal(mcpStore.getSnapshot().servers[0]?.state, 'running');
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

test('save of a starting server polls until it leaves starting', async () => {
	mcpStore.setEngineReady(true);
	await new Promise(resolve => setImmediate(resolve));
	let lists = 0;
	mcpStore.bindApi(
		api({
			put: async () => ({ok: true, mcpServers: [server('fresh', {state: 'starting'})]}),
			list: async () => {
				lists += 1;
				return {ok: true, mcpServers: [server('fresh', {state: 'running', pid: 3})]};
			}
		})
	);
	mock.timers.enable({apis: ['setTimeout']});
	try {
		const done = await mcpStore.save('fresh', {command: 'uvx'});
		assert.equal(done, true);
		assert.equal(mcpStore.getSnapshot().servers[0]?.state, 'starting');
		assert.equal(lists, 0);
		mock.timers.tick(1500);
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(lists, 1);
		assert.equal(mcpStore.getSnapshot().servers[0]?.state, 'running');
	} finally {
		mock.timers.reset();
	}
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

test('import with empty rows re-lists instead of wiping', async () => {
	mcpStore.bindApi(
		api({
			import: async () => ({ok: true, mcpServers: []}),
			list: async () => ({ok: true, mcpServers: [server('blender')]})
		})
	);
	mcpStore.setEngineReady(true);
	await mcpStore.list();
	const done = await mcpStore.importServers({mcpServers: {blender: {command: 'uvx'}}});
	assert.equal(done, true);
	assert.equal(mcpStore.getSnapshot().servers[0]?.name, 'blender');
});

test('reload failure sets notice', async () => {
	mcpStore.bindApi(api({reload: async () => ({ok: false, notice: 'invalid yaml'})}));
	mcpStore.setEngineReady(true);
	const done = await mcpStore.reload();
	assert.equal(done, false);
	assert.equal(mcpNoticeKind(mcpStore.getSnapshot().notice ?? ''), 'InvalidJson');
});

test('queued list after a starting snapshot applies running', async () => {
	let lists = 0;
	let release!: () => void;
	const gate = new Promise<void>(resolve => {
		release = resolve;
	});
	mcpStore.bindApi(
		api({
			list: async () => {
				const n = ++lists;
				if (n === 1) await gate;
				return {ok: true, mcpServers: [server('blender', {state: n === 1 ? 'starting' : 'running', pid: 1})]};
			}
		})
	);
	mcpStore.setEngineReady(true);
	const started = Date.now();
	while (lists < 1 && Date.now() - started < 1000) await new Promise(r => setTimeout(r, 5));
	assert.equal(lists, 1);
	const follow = mcpStore.list();
	release();
	await follow;
	const until = Date.now() + 1000;
	while (mcpStore.getSnapshot().servers[0]?.state !== 'running' && Date.now() < until) {
		await new Promise(r => setTimeout(r, 5));
	}
	assert.equal(mcpStore.getSnapshot().servers[0]?.state, 'running');
	assert.equal(lists, 2);
});

test('rowState uses exact tokens so disconnected is not starting', () => {
	assert.equal(rowState(server('a', {state: 'starting'})).key, 'starting');
	assert.equal(rowState(server('a', {state: 'running'})).key, 'running');
	assert.equal(rowState(server('a', {state: 'disconnected'})).key, 'stopped');
	assert.equal(rowState(server('a', {connectionStatus: 'disconnected'})).key, 'stopped');
	assert.equal(rowState(server('a', {state: 'failed'})).key, 'failed');
});
