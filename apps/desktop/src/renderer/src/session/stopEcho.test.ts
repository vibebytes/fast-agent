import assert from 'node:assert/strict';
import test from 'node:test';
import {
	activeStopEcho,
	markStopRequested,
	requestStop,
	settleStopEcho,
	subscribeStopEcho,
	STOP_ECHO_TTL_MS
} from './stopEcho.js';

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

test('markStopRequested creates an active echo for the session', () => {
	settleStopEcho(null);
	const at = 1_000_000;
	markStopRequested('s1', 'r1', at);
	const echo = activeStopEcho('s1', at + 1);
	assert.ok(echo);
	assert.equal(echo.sessionId, 's1');
	assert.equal(echo.runId, 'r1');
	assert.equal(echo.at, at);
	assert.equal(echo.expiresAt, at + STOP_ECHO_TTL_MS);
	settleStopEcho(null);
});

test('an echo never matches a different session', () => {
	settleStopEcho(null);
	markStopRequested('s1', undefined, 1_000_000);
	assert.equal(activeStopEcho('s2', 1_000_001), null);
	assert.equal(settleStopEcho('s2', 1_000_001), false);
	assert.ok(activeStopEcho('s1', 1_000_001));
	settleStopEcho(null);
});

test('a null session echo matches any session (global chrome affordance)', () => {
	settleStopEcho(null);
	markStopRequested(null, undefined, 1_000_000);
	assert.ok(activeStopEcho('s1', 1_000_001));
	assert.ok(activeStopEcho(null, 1_000_001));
	assert.equal(settleStopEcho('s2', 1_000_002), true);
	assert.equal(activeStopEcho('s1', 1_000_003), null);
});

test('the echo expires on its TTL without being reflected', async () => {
	settleStopEcho(null);
	const at = Date.now();
	markStopRequested('s1', undefined, at, 20);
	assert.ok(activeStopEcho('s1', at + 19));
	await sleep(30);
	assert.equal(activeStopEcho('s1', Date.now()), null);
	settleStopEcho(null);
});

test('settleStopEcho retires the echo exactly once', () => {
	settleStopEcho(null);
	markStopRequested('s1', undefined, 1_000_000);
	assert.equal(settleStopEcho('s1', 1_000_005), true);
	assert.equal(activeStopEcho('s1', 1_000_006), null);
	assert.equal(settleStopEcho('s1', 1_000_007), false);
});

test('a fresh mark replaces the previous echo instead of stacking', () => {
	settleStopEcho(null);
	markStopRequested('s1', 'r1', 1_000_000, 5_000);
	markStopRequested('s1', 'r2', 1_000_100, 5_000);
	const echo = activeStopEcho('s1', 1_000_101);
	assert.ok(echo);
	assert.equal(echo.runId, 'r2');
	assert.equal(echo.at, 1_000_100);
	settleStopEcho(null);
});

test('subscribers are notified on mark and settle, not on reads', async () => {
	settleStopEcho(null);
	let events = 0;
	const unsubscribe = subscribeStopEcho(() => {
		events++;
	});
	markStopRequested('s1', undefined, 1_000_000);
	const afterMark = events;
	assert.equal(afterMark, 1);
	assert.ok(activeStopEcho('s1', 1_000_001));
	assert.equal(events, afterMark, 'reads must not notify');
	await sleep(10);
	settleStopEcho('s1', 1_000_002);
	assert.equal(events, 2);
	unsubscribe();
	markStopRequested('s1', undefined, 1_000_000);
	assert.equal(events, 2, 'unsubscribed listeners stay quiet');
	settleStopEcho(null);
});

test('the TTL timer retires a stale echo on its own', async () => {
	settleStopEcho(null);
	let events = 0;
	const unsubscribe = subscribeStopEcho(() => {
		events++;
	});
	markStopRequested('s1', undefined, Date.now(), 15);
	const baseline = events;
	await sleep(40);
	assert.equal(events, baseline + 1, 'timer retirement notifies subscribers');
	assert.equal(activeStopEcho('s1', Date.now()), null);
	unsubscribe();
});

test('stopping feedback paints in the same tick (≤1 frame)', () => {
	settleStopEcho(null);
	let sameTickEcho: unknown = 'unread';
	const unsubscribe = subscribeStopEcho(() => {
		sameTickEcho = activeStopEcho('s1', Date.now());
	});
	markStopRequested('s1', 'r9', Date.now());
	assert.ok(sameTickEcho, 'echo must already be active inside the mark handler itself');
	unsubscribe();
	settleStopEcho(null);
});

test('requestStop shows no echo when the main process guards the stop', async () => {
	settleStopEcho(null);
	const sent = await requestStop('s1', async () => false);
	assert.equal(sent, false);
	assert.equal(activeStopEcho('s1', Date.now()), null);
});

test('requestStop echoes only after the main process dispatches', async () => {
	settleStopEcho(null);
	let echoedBeforeAck: unknown = 'unread';
	const sent = await requestStop('s1', async () => {
		echoedBeforeAck = activeStopEcho('s1', Date.now());
		return true;
	});
	assert.equal(echoedBeforeAck, null);
	assert.equal(sent, true);
	assert.ok(activeStopEcho('s1', Date.now()));
	settleStopEcho(null);
});
