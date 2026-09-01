/**
 * Mock-engine: engine generation (epoch) change while an approval is pending.
 * A second `ready` with a different engineEpoch must clear the stale dialog
 * and surface a restart notice — the UI must never keep waiting on gates that
 * died with the previous engine process.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';

test('PTY engine epoch change clears a pending approval dialog', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 30_000);

		await h.submit('引擎换代测试');
		await h.waitForScreen(/Do you want to proceed/, 'approval dialog', 30_000);

		// Mock emits a second ready with a new engineEpoch after 1.5s.
		await h.waitForScreenGone(/❯ 1\. Yes/, 'stale approval dialog dropped on epoch change', 15_000);
		await h.waitForScreen(/引擎已重启/, 'restart notice in transcript', 10_000);

		const screen = await h.screenText();
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
