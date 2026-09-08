import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {createTranscriptState, type TranscriptState} from './transcriptProjection.js';
import {RUN_LEASE_INTERVAL_MS, RUN_LEASE_TTL_MS} from './composerGate.js';
import {chromeRunId, type RunChrome} from './runChrome.js';
import {
	createLeaseWatch,
	hasLocalRun,
	isLeaseRenewal,
	type LeaseTimers,
	type LeaseWatchTask
} from './leaseWatch.js';

type FakeTimers = LeaseTimers & {advance: (ms: number) => void};

function fakeTimers(): FakeTimers {
	let time = 0;
	const jobs: {at: number; fn: () => void; every: number | null; handle: number}[] = [];
	let next = 1;
	const fire = (until: number): void => {
		for (;;) {
			const due = jobs.filter(j => j.at <= until).sort((a, b) => a.at - b.at)[0];
			if (!due) break;
			jobs.splice(jobs.indexOf(due), 1);
			time = due.at;
			due.fn();
			if (due.every != null) jobs.push({...due, at: due.at + due.every});
		}
	};
	return {
		now: () => time,
		setTimeout: (fn, ms) => {
			const handle = next++;
			jobs.push({at: time + ms, fn, every: null, handle});
			return handle;
		},
		clearTimeout: handle => {
			const i = jobs.findIndex(j => j.handle === handle);
			if (i >= 0) jobs.splice(i, 1);
		},
		setInterval: (fn, ms) => {
			const handle = next++;
			jobs.push({at: time + ms, fn, every: ms, handle});
			return handle;
		},
		clearInterval: handle => {
			const i = jobs.findIndex(j => j.handle === handle);
			if (i >= 0) jobs.splice(i, 1);
		},
		advance: ms => {
			time += ms;
			fire(time);
		}
	};
}

const chrome: RunChrome = {phase: 'active', runId: 'run-1', fromServer: false};

const task = (overrides: Partial<TranscriptState> = {}, id = 't1'): LeaseWatchTask & {
	sessionId: string | null;
	busy: boolean;
} => ({
	id,
	sessionId: 'sess-1',
	busy: true,
	transcript: {...createTranscriptState(), leaseAware: true, chrome, ...overrides}
});

const ev = (type: BridgeEvent['type']): BridgeEvent =>
	({type, ts: 0, seq: 1, sessionId: 'sess-1'}) as unknown as BridgeEvent;

test('isLeaseRenewal covers heartbeat and terminal events only', () => {
	assert.equal(isLeaseRenewal('run_state'), true);
	for (const t of ['turn_finished', 'turn_cancelled', 'run_done', 'run_failed', 'run_cancelled', 'run_exhausted']) {
		assert.equal(isLeaseRenewal(t as BridgeEvent['type']), true);
	}
	assert.equal(isLeaseRenewal('assistant_delta'), false);
});

test('hasLocalRun keys on pinned run id or streaming entries', () => {
	assert.equal(hasLocalRun({...createTranscriptState(), chrome}), true);
	assert.equal(
		hasLocalRun({
			...createTranscriptState(),
			entries: [{status: 'streaming'}] as TranscriptState['entries']
		}),
		true
	);
	assert.equal(hasLocalRun(createTranscriptState()), false);
	assert.equal(chromeRunId(chrome), 'run-1');
});

test('noteRunLease stamps seen time and arm the scan interval', () => {
	const timers = fakeTimers();
	let t = task();
	const watch = createLeaseWatch({
		now: timers.now,
		scanIntervalMs: 1000,
		cancelSettleTimeoutMs: 5000,
		timers,
		tasks: () => [t],
		busy: task => task.busy,
		sessionIdOf: task => task.sessionId,
		onReconcile: () => {},
		onExpire: () => {},
		cancelSettleDue: () => {}
	});
	assert.equal(watch.leaseScanArmed, false);
	watch.noteRunLease(t, ev('assistant_delta'));
	assert.equal(watch.leaseScanArmed, true, 'busy task arms on any event');
	watch.stopLeaseScan();
	assert.equal(watch.leaseScanArmed, false);
	t.busy = false;
	watch.noteRunLease(t, ev('run_state'));
	assert.equal(watch.leaseScanArmed, false, 'idle task never arms');
});

test('cancel-settle timer fires force settlement once, then clears', () => {
	const timers = fakeTimers();
	const t = task({chrome: {phase: 'cancelPending', runId: 'run-1', fromServer: false}});
	const due: string[] = [];
	const watch = createLeaseWatch({
		now: timers.now,
		scanIntervalMs: 1000,
		cancelSettleTimeoutMs: 5000,
		timers,
		tasks: () => [t],
		busy: () => true,
		sessionIdOf: () => null,
		onReconcile: () => {},
		onExpire: () => {},
		cancelSettleDue: id => due.push(id)
	});
	watch.syncCancelSettle(t);
	assert.equal(watch.pendingCancelSettleCount, 1);
	watch.syncCancelSettle(t);
	assert.equal(watch.pendingCancelSettleCount, 1, 'sync must not stack timers');
	timers.advance(4999);
	assert.deepEqual(due, []);
	timers.advance(1);
	assert.deepEqual(due, ['t1']);
	assert.equal(watch.pendingCancelSettleCount, 0);
	watch.syncCancelSettle(task({chrome: {phase: 'settled'}}));
	assert.equal(watch.pendingCancelSettleCount, 0, 'settled chrome must not arm');
});

test('tickRunLeases reconciles then settles expired leases', () => {
	const timers = fakeTimers();
	let t = task();
	const reconciled: string[] = [];
	const expired: string[] = [];
	let changeCount = 0;
	const watch = createLeaseWatch({
		now: timers.now,
		scanIntervalMs: 0,
		cancelSettleTimeoutMs: 5000,
		timers,
		tasks: () => [t],
		busy: task => task.busy,
		sessionIdOf: task => task.sessionId,
		onReconcile: task => reconciled.push(task.id),
		onExpire: task => expired.push(task.id),
		cancelSettleDue: () => {},
		onChange: () => {
			changeCount += 1;
		}
	});
	timers.advance(RUN_LEASE_TTL_MS + 1);
	watch.tickRunLeases();
	assert.equal(reconciled.length, 0, 'no renewal seen yet — nothing to reconcile');

	watch.noteRunLease(t, ev('run_state'));
	timers.advance(RUN_LEASE_TTL_MS + 1);
	watch.tickRunLeases();
	assert.deepEqual(reconciled, ['t1']);

	watch.noteRunLease(t, ev('run_state'));
	timers.advance(RUN_LEASE_TTL_MS + 1);
	watch.tickRunLeases();
	assert.deepEqual(reconciled, ['t1', 't1'], 'renewal past TTL reconciles again');

	assert.deepEqual(expired, []);
	watch.tickRunLeases();
	assert.deepEqual(expired, [], 'reconcile grace window keeps the lease');

	timers.advance(RUN_LEASE_INTERVAL_MS + 1);
	watch.tickRunLeases();
	assert.deepEqual(expired, ['t1'], 'silence past reconcile window settles locally');
	assert.equal(changeCount, 1);
});

test('tickRunLeases ignores tasks that are not busy', () => {
	const timers = fakeTimers();
	const t = task({leaseAware: false});
	t.busy = false;
	const expired: string[] = [];
	const watch = createLeaseWatch({
		now: timers.now,
		scanIntervalMs: 1000,
		cancelSettleTimeoutMs: 5000,
		timers,
		tasks: () => [t],
		busy: task => task.busy,
		sessionIdOf: () => null,
		onReconcile: () => {},
		onExpire: task => expired.push(task.id),
		cancelSettleDue: () => {}
	});
	watch.noteRunLease(t, ev('run_state'));
	assert.equal(watch.leaseScanArmed, false, 'not busy — no scan');
	timers.advance(RUN_LEASE_TTL_MS * 10);
	watch.tickRunLeases();
	assert.deepEqual(expired, []);
});

test('busy task with no renewal event at all still expires (run_state is droppable)', () => {
	const timers = fakeTimers();
	const t = task({leaseAware: false});
	const expired: string[] = [];
	const watch = createLeaseWatch({
		now: timers.now,
		scanIntervalMs: 1000,
		cancelSettleTimeoutMs: 5000,
		timers,
		tasks: () => [t],
		busy: task => task.busy,
		sessionIdOf: () => null,
		onReconcile: () => {},
		onExpire: task => expired.push(task.id),
		cancelSettleDue: () => {}
	});
	watch.noteRunLease(t, ev('assistant_delta'));
	assert.equal(watch.leaseScanArmed, true, 'busy arms the scan without a renewal event');
	timers.advance(RUN_LEASE_TTL_MS + RUN_LEASE_INTERVAL_MS * 2 + 2);
	assert.deepEqual(expired, ['t1'], 'silence from the first busy scan settles locally');
});

test('dispose drops timers and bookkeeping, re-armable afterwards', () => {
	const timers = fakeTimers();
	const t = task({chrome: {phase: 'cancelPending', runId: 'run-1', fromServer: false}});
	const due: string[] = [];
	const watch = createLeaseWatch({
		now: timers.now,
		scanIntervalMs: 1000,
		cancelSettleTimeoutMs: 5000,
		timers,
		tasks: () => [t],
		busy: () => true,
		sessionIdOf: () => null,
		onReconcile: () => {},
		onExpire: () => {},
		cancelSettleDue: id => due.push(id)
	});
	watch.noteRunLease(t, ev('run_state'));
	watch.syncCancelSettle(t);
	assert.equal(watch.leaseScanArmed, true);
	assert.equal(watch.pendingCancelSettleCount, 1);
	watch.dispose();
	assert.equal(watch.leaseScanArmed, false);
	assert.equal(watch.pendingCancelSettleCount, 0);
	timers.advance(60_000);
	assert.deepEqual(due, [], 'disposed cancel-settle timer must not fire');
	watch.noteRunLease(t, ev('run_state'));
	assert.equal(watch.leaseScanArmed, true, 'watch is re-armable after dispose');
});
