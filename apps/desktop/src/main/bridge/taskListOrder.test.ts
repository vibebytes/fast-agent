/**
 * Sidebar task list-order contract.
 *
 * Invariants (must hold after every step — snapshot titles, never only the final state):
 * 1. listTasks is sorted by listOrder desc only.
 * 2. createTask is immediately index 0 among existing rows.
 * 3. listOrder never changes after create.
 * 4. Production CreateSession: ready may arrive before command_result; only
 *    acceptNewSession(sessionId, taskId) binds — still one row at index 0.
 * 5. Meta before bind may insert an inventory stub; accept collapses to one row.
 * 6. Stale meta (only older sessions) must not steal the unbound pending create.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {BridgeCommand} from '@fastllm/bridge-protocol';
import {SessionController} from './SessionController.js';

/** Fixed-clock controller with explicit tick for multi-create ordering. */
function clockController(start = 1_700_000_000_000) {
	let clock = start;
	let n = 0;
	const c = new SessionController({
		clientId: 'cli',
		send: () => true,
		now: () => clock,
		createId: () => `id-${++n}`
	});
	return {
		c,
		tick(ms = 1) {
			clock += ms;
		},
		titles: () => c.listTasks().map(t => t.title),
		ids: () => c.listTasks().map(t => t.id),
		top: () => c.listTasks()[0] ?? null
	};
}

function iso(ms: number): string {
	return new Date(ms).toISOString();
}

test('invariant: createTask is immediately first and stays first after ready→accept→meta', () => {
	const {c, tick, titles, top} = clockController();
	c.hydrateFromMeta([
		{id: 'sess-old', title: 'Older', lastModified: iso(1_600_000_000_000)},
		{id: 'sess-mid', title: 'Middle', lastModified: iso(1_650_000_000_000)}
	]);
	assert.deepEqual(titles(), ['Middle', 'Older']);

	tick(10);
	const created = c.createTask('New task');
	assert.deepEqual(titles(), ['New task', 'Middle', 'Older'], 'step: after create');
	assert.equal(top()?.id, created.id);
	const order = created.listOrder;

	// ready before CreateSession command_result — must not bind.
	c.handleEvent({type: 'ready', sessionId: 'sess-new', protocolVersion: 2});
	assert.equal(created.sessionId, null, 'step: ready must not bind');
	assert.deepEqual(titles(), ['New task', 'Middle', 'Older'], 'step: after ready');
	assert.equal(created.listOrder, order);

	c.acceptNewSession('sess-new', created.id);
	assert.equal(created.sessionId, 'sess-new');
	assert.deepEqual(titles(), ['New task', 'Middle', 'Older'], 'step: after accept');

	// Engine Instant may look older/newer; must not move listOrder.
	c.hydrateFromMeta([
		{id: 'sess-old', title: 'Older', lastModified: iso(1_600_000_000_000)},
		{id: 'sess-mid', title: 'Middle', lastModified: iso(1_650_000_000_000)},
		{id: 'sess-new', title: 'New Task', lastModified: iso(1_500_000_000_000)}
	]);
	assert.deepEqual(titles(), ['New Task', 'Middle', 'Older'], 'step: after meta (title only)');
	assert.equal(top()?.id, created.id);
	assert.equal(top()?.listOrder, order);
	assert.equal(c.listTasks().length, 3, 'no duplicate row');
});

test('invariant: meta before accept inserts stub — accept collapses; pending stays top', () => {
	const {c, tick, titles, top} = clockController();
	c.hydrateFromMeta([
		{id: 'sess-old', title: 'Older', lastModified: iso(1_600_000_000_000)}
	]);
	tick(5);
	const created = c.createTask('New task');
	assert.deepEqual(titles(), ['New task', 'Older'], 'step: after create');
	const order = created.listOrder;

	// Meta arrives before command_result — inventory stub, not claim.
	c.hydrateFromMeta([
		{id: 'sess-old', title: 'Older', lastModified: iso(1_600_000_000_000)},
		{id: 'sess-new', title: 'New Task', lastModified: iso(created.listOrder)}
	]);
	assert.equal(created.sessionId, null, 'meta must not claim pending');
	assert.equal(top()?.id, created.id);
	assert.equal(created.listOrder, order);
	assert.ok(c.listTasks().some(t => t.sessionId === 'sess-new' && t.id !== created.id));

	c.acceptNewSession('sess-new', created.id);
	assert.equal(created.sessionId, 'sess-new');
	assert.equal(c.listTasks().length, 2, 'step: accept collapses stub');
	assert.deepEqual(titles(), ['New task', 'Older'], 'step: after accept');
	assert.equal(top()?.id, created.id);
	assert.equal(created.listOrder, order);
});

test('invariant: stale meta with only older sessions must not steal pending', () => {
	const {c, tick, titles, top} = clockController();
	tick(100);
	const created = c.createTask('New task');
	assert.equal(top()?.id, created.id);
	assert.equal(created.sessionId, null);

	// Cold-start meta in flight: only historical sessions.
	c.hydrateFromMeta([
		{id: 'sess-a', title: 'A', lastModified: iso(1_600_000_000_000)},
		{id: 'sess-b', title: 'B', lastModified: iso(1_650_000_000_000)}
	]);
	assert.equal(created.sessionId, null, 'stale meta must not bind pending');
	assert.equal(top()?.id, created.id, 'pending stays on top');
	assert.deepEqual(titles()[0], 'New task');
	assert.ok(titles().includes('A'));
	assert.ok(titles().includes('B'));

	c.acceptNewSession('sess-new', created.id);
	assert.equal(created.sessionId, 'sess-new');
	assert.equal(top()?.id, created.id);
});

test('invariant: rapid creates stay newest-first; bind does not reorder', () => {
	const {c, tick, titles, ids} = clockController();
	c.hydrateFromMeta([{id: 'sess-old', title: 'Older', lastModified: iso(1_600_000_000_000)}]);

	tick(1);
	const a = c.createTask('A');
	c.acceptNewSession('sess-a', a.id);
	tick(1);
	const b = c.createTask('B');
	c.acceptNewSession('sess-b', b.id);
	tick(1);
	const d = c.createTask('C');
	assert.deepEqual(titles(), ['C', 'B', 'A', 'Older']);
	assert.deepEqual(ids().slice(0, 3), [d.id, b.id, a.id]);

	c.acceptNewSession('sess-c', d.id);
	c.hydrateFromMeta([
		{id: 'sess-old', title: 'Older', lastModified: iso(1_600_000_000_000)},
		{id: 'sess-a', title: 'A', lastModified: iso(1_900_000_000_000)},
		{id: 'sess-b', title: 'B', lastModified: iso(1_800_000_000_000)},
		{id: 'sess-c', title: 'C', lastModified: iso(1_700_000_000_000)}
	]);
	assert.deepEqual(titles(), ['C', 'B', 'A', 'Older'], 'engine timestamps must not reorder');
});

test('invariant: attach dedupes hydrate stub that raced in for same sessionId', () => {
	const sent: BridgeCommand[] = [];
	let n = 0;
	let clock = 1_700_000_000_000;
	const c = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => clock,
		createId: () => `x-${++n}`
	});
	c.hydrateFromMeta([{id: 'sess-old', title: 'Older', lastModified: iso(1_600_000_000_000)}]);
	clock += 10;
	const created = c.createTask('New task');

	// Competing inventory stub for the new session.
	c.hydrateFromMeta([
		{id: 'sess-old', title: 'Older', lastModified: iso(1_600_000_000_000)},
		{id: 'sess-new', title: 'Stub', lastModified: iso(1_000_000_000_000)}
	]);
	assert.equal(created.sessionId, null);
	assert.ok(c.listTasks().some(t => t.title === 'Stub'));
	assert.equal(c.listTasks()[0]?.id, created.id, 'pending still first');

	c.acceptNewSession('sess-new', created.id);
	assert.equal(created.sessionId, 'sess-new');
	assert.equal(
		c.listTasks().filter(t => t.sessionId === 'sess-new').length,
		1,
		'exactly one row for sess-new'
	);
	assert.equal(c.listTasks()[0]?.id, created.id);
	assert.ok(!c.listTasks().some(t => t.title === 'Stub'));
});

test('invariant: pendingNew clear must not change list position', () => {
	const {c, tick, titles, top} = clockController();
	c.hydrateFromMeta([
		{id: 's1', title: 'One', lastModified: iso(1_600_000_000_000)},
		{id: 's2', title: 'Two', lastModified: iso(1_650_000_000_000)}
	]);
	tick(1);
	const created = c.createTask('New task');
	assert.equal(created.pendingNew, true);
	assert.deepEqual(titles(), ['New task', 'Two', 'One']);

	c.acceptNewSession('sess-new', created.id);
	assert.equal(created.pendingNew, false);
	assert.deepEqual(titles(), ['New task', 'Two', 'One'], 'clearing pendingNew must not resort');
	assert.equal(top()?.id, created.id);
});

test('invariant: failPendingCreate removes optimistic row', () => {
	const {c, tick, titles, top} = clockController();
	c.hydrateFromMeta([{id: 'sess-old', title: 'Older', lastModified: iso(1_600_000_000_000)}]);
	tick(1);
	const created = c.createTask('New task');
	assert.equal(top()?.id, created.id);
	assert.equal(c.failPendingCreate(created.id), true);
	assert.ok(!c.listTasks().some(t => t.id === created.id));
	assert.deepEqual(titles(), ['Older']);
});

test('newer Meta lastModified advances recency without moving listOrder', () => {
	const {c, top} = clockController();
	c.hydrateFromMeta([{id: 'sess-old', title: 'Older', lastModified: iso(1_600_000_000_000)}]);
	const row = top();
	assert.ok(row);
	const order = row.listOrder;
	assert.equal(row.lastModified, iso(1_600_000_000_000));

	c.hydrateFromMeta([{id: 'sess-old', title: 'Older', lastModified: iso(1_900_000_000_000)}]);
	assert.equal(top()?.listOrder, order, 'listOrder must stay frozen');
	assert.equal(top()?.lastModified, iso(1_900_000_000_000), 'lastModified may move forward');

	c.hydrateFromMeta([{id: 'sess-old', title: 'Older', lastModified: iso(1_500_000_000_000)}]);
	assert.equal(top()?.listOrder, order);
	assert.equal(top()?.lastModified, iso(1_900_000_000_000), 'older Meta must not rewind recency');
});
