import assert from 'node:assert/strict';
import test from 'node:test';
import {createMcpAppCatalog, type McpAppListResult} from './catalog.js';
import type {McpAppRow} from '@fastllm/bridge-client';

function row(server: string, uri: string): McpAppRow {
	return {server, tool: `t-${uri}`, remoteTool: `r-${uri}`, resourceUri: uri, visibility: ['model', 'app']};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(r => {
		resolve = r;
	});
	return {promise, resolve};
}

const ok = (apps: McpAppRow[]): McpAppListResult => ({ok: true, apps});
const fail = (notice: string): McpAppListResult => ({ok: false, notice});

test('starts idle with no live set so a tab sweep cannot run before discovery', async () => {
	const catalog = createMcpAppCatalog(async () => ok([]));
	assert.equal(catalog.get().status, 'idle');
	assert.equal(catalog.liveKeys(), null);
});

test('a load publishes the app list and the live keys', async () => {
	const catalog = createMcpAppCatalog(async () => ok([row('blender', 'ui://a.html')]));
	await catalog.load();
	assert.equal(catalog.get().status, 'ready');
	assert.deepEqual([...catalog.liveKeys()!], ['blender\u0000ui://a.html']);
});

test('concurrent loads share one request', async () => {
	const gate = deferred<McpAppListResult>();
	let calls = 0;
	const catalog = createMcpAppCatalog(() => {
		calls += 1;
		return gate.promise;
	});
	const first = catalog.load();
	const second = catalog.load();
	gate.resolve(ok([row('blender', 'ui://a.html')]));
	await Promise.all([first, second]);
	assert.equal(calls, 1);
	assert.equal(catalog.get().apps.length, 1);
});

test('a stale response from a superseded reload never overwrites a newer one', async () => {
	const slow = deferred<McpAppListResult>();
	const fast = deferred<McpAppListResult>();
	const queue = [slow, fast];
	const catalog = createMcpAppCatalog(() => queue.shift()!.promise);
	const first = catalog.load();
	const second = catalog.load({force: true});
	fast.resolve(ok([row('new', 'ui://n.html')]));
	await second;
	slow.resolve(ok([row('old', 'ui://o.html')]));
	await first;
	assert.deepEqual(
		catalog.get().apps.map(a => a.server),
		['new']
	);
});

test('a failed load keeps the last good list and reports the error', async () => {
	let answer: McpAppListResult = ok([row('blender', 'ui://a.html')]);
	const catalog = createMcpAppCatalog(async () => answer);
	await catalog.load();
	answer = fail('engine_not_ready');
	await catalog.load();
	assert.equal(catalog.get().status, 'error');
	assert.equal(catalog.get().notice, 'engine_not_ready');
	assert.equal(catalog.get().apps.length, 1);
});

test('a failed first load leaves the live set unknown so a cold engine never wipes the rail', async () => {
	const catalog = createMcpAppCatalog(async () => fail('engine_not_ready'));
	await catalog.load();
	assert.equal(catalog.get().status, 'error');
	assert.equal(catalog.liveKeys(), null);
});

test('subscribers hear every state change and stop after unsubscribing', async () => {
	const catalog = createMcpAppCatalog(async () => ok([]));
	const seen: string[] = [];
	const off = catalog.subscribe(s => seen.push(s.status));
	await catalog.load();
	off();
	await catalog.load();
	assert.deepEqual(seen, ['loading', 'ready']);
});

test('an unchanged list keeps the same array reference', async () => {
	const apps = [row('blender', 'ui://a.html')];
	const catalog = createMcpAppCatalog(async () => ok(apps));
	await catalog.load();
	const first = catalog.get().apps;
	await catalog.load();
	assert.equal(catalog.get().apps, first);
});
