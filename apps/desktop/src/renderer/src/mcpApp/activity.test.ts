import assert from 'node:assert/strict';
import test from 'node:test';
import {activityLabel, readAppCall, reduceAppActivity, type AppActivityRow} from './activity.js';
import {McpAppBus} from './store.js';

const call = (tool: string, status = 'ok', durationMs = 12): ReturnType<typeof readAppCall> => ({
	type: 'mcp_app_call',
	server: 'blender',
	tool,
	status,
	durationMs,
	origin: 'app',
	detail: ''
});

test('an app call is read into a row and anything else is ignored', () => {
	assert.deepEqual(readAppCall({type: 'mcp_app_result', server: 'blender', tool: 'x'}), null);
	assert.equal(readAppCall({type: 'mcp_app_call', tool: 'x'}), null);
	const parsed = readAppCall({type: 'mcp_app_call', server: 'blender', tool: 'viewport', status: 'rate_limited', durationMs: 40});
	assert.deepEqual(parsed, {
		type: 'mcp_app_call',
		server: 'blender',
		tool: 'viewport',
		status: 'rate_limited',
		durationMs: 40,
		origin: 'app',
		detail: ''
	});
});

test('a denied call defaults to the error status rather than a blank one', () => {
	assert.equal(readAppCall({type: 'mcp_app_call', server: 's', tool: 't'})?.status, 'error');
});

test('consecutive calls of the same tool collapse, a different tool starts a new row', () => {
	let rows: AppActivityRow[] = [];
	rows = reduceAppActivity(rows, call('viewport', 'ok', 10)!);
	rows = reduceAppActivity(rows, call('viewport', 'ok', 20)!);
	rows = reduceAppActivity(rows, call('render', 'ok', 30)!);
	assert.equal(rows.length, 2);
	assert.deepEqual(
		rows.map(r => [r.tool, r.count, r.durationMs]),
		[
			['viewport', 2, 20],
			['render', 1, 30]
		]
	);
});

test('the collapsed row keeps the latest status and detail', () => {
	let rows: AppActivityRow[] = [];
	rows = reduceAppActivity(rows, call('viewport', 'ok', 10)!);
	rows = reduceAppActivity(rows, {...call('viewport', 'approval_required', 0), detail: 'approval_required'}!);
	assert.equal(rows.length, 1);
	assert.equal(rows[0]!.status, 'approval_required');
	assert.equal(rows[0]!.detail, 'approval_required');
});

test('the list is capped so a polling page cannot grow it forever', () => {
	let rows: AppActivityRow[] = [];
	for (let i = 0; i < 5; i++) rows = reduceAppActivity(rows, call(`t${i}`)!, 3);
	assert.equal(rows.length, 3);
	assert.deepEqual(
		rows.map(r => r.tool),
		['t2', 't3', 't4']
	);
});

test('the label states the tool, the status and the collapsed count', () => {
	const [row] = reduceAppActivity(reduceAppActivity([], call('viewport', 'ok', 10)!), call('viewport', 'rate_limited', 40)!);
	assert.equal(activityLabel(row!), 'blender / viewport ×2 · rate_limited · 40ms');
	assert.equal(activityLabel({...row!, count: 1}), 'blender / viewport · rate_limited · 40ms');
});

test('the bus keeps page calls per server, drops look-alikes and unsubscribes', () => {
	const bus = new McpAppBus();
	const seen: string[] = [];
	const off = bus.subscribeActivity((server, rows) => seen.push(`${server}:${activityLabel(rows[rows.length - 1]!)}`));
	assert.equal(bus.noteCall(call('viewport')), 'blender');
	assert.equal(bus.noteCall({type: 'mcp_app_result', server: 'blender'}), null);
	assert.equal(bus.noteCall(null), null);
	assert.equal(bus.activityFor('blender').length, 1);
	assert.equal(bus.activityFor('other').length, 0);
	assert.deepEqual(seen, ['blender:blender / viewport · ok · 12ms']);
	off();
	assert.equal(bus.noteCall(call('render')), 'blender');
	assert.equal(seen.length, 1);
});
