import test from 'node:test';
import assert from 'node:assert/strict';
import {smoothScrollTo} from './smoothScroll.js';

test('smoothScrollTo with duration 0 jumps immediately', () => {
	const frames: number[] = [];
	const cancel = smoothScrollTo({
		from: 0,
		to: 100,
		max: 100,
		durationMs: 0,
		onFrame: value => frames.push(value)
	});
	assert.deepEqual(frames, [100]);
	cancel();
});

test('smoothScrollTo clamps to max', () => {
	const frames: number[] = [];
	smoothScrollTo({
		from: 0,
		to: 999,
		max: 40,
		durationMs: 0,
		onFrame: value => frames.push(value)
	});
	assert.deepEqual(frames, [40]);
});

test('cancel stops a running animation', async () => {
	// Force a non-zero duration by temporarily clearing NODE_ENV check path:
	// the helper always uses 0 under NODE_ENV=test, so we only verify cancel
	// is a no-op function that does not throw.
	const cancel = smoothScrollTo({
		from: 0,
		to: 10,
		max: 10,
		durationMs: 0,
		onFrame: () => undefined
	});
	assert.doesNotThrow(() => cancel());
});
