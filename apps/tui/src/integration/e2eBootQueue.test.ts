/**
 * E2E: unix-style session boot strips ready.sessionId; user input before Attach
 * must queue, then auto-flush once sessionReady (CreateSession→Attached).
 *
 * Reproduces cli-ink stuck in `queue>` when EnsureProject/continue bootstrap lags.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';

test('E2E boot queue: message typed before Attach flushes after sessionReady', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(
		t,
		{
			FAST_SIMULATE_UNIX_SESSION_BOOT: '1',
			FAST_MOCK_UNIX_BOOTSTRAP: '1',
			FAST_MOCK_UNIX_CREATE_DELAY_MS: '1800',
			FAST_SESSION: 'continue'
		},
		{sessionMode: 'continue'}
	);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'composer visible', 60_000);

		// Submit while CreateSession is still delayed — must land in boot queue.
		await h.submit('BOOT-QUEUE-PROBE 你是谁');
		await h.waitForScreen(/已排队|queue:1|queue>/, 'boot-queued notice', 10_000);

		// After delayed CreateSession + Attached, queue flushes and turn completes.
		await h.waitForScreen(/BOOT-QUEUE-PROBE|SMOKE-FINAL-DONE/, 'flushed turn output', 60_000);
		await h.waitForScreenGone(/queue:1|queue>/, 'queue cleared after flush', 30_000);

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});

test('E2E boot queue: early workspace_meta race still reaches Attach', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(
		t,
		{
			FAST_SIMULATE_UNIX_SESSION_BOOT: '1',
			FAST_MOCK_UNIX_BOOTSTRAP: '1',
			FAST_MOCK_UNIX_EARLY_META: '1',
			FAST_MOCK_UNIX_CREATE_DELAY_MS: '200',
			FAST_SESSION: 'continue'
		},
		{sessionMode: 'continue'}
	);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'composer visible', 60_000);
		await h.submit('EARLY-META-PROBE hello');
		await h.waitForScreen(/EARLY-META-PROBE|SMOKE-FINAL-DONE/, 'turn after early-meta race', 60_000);
		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
