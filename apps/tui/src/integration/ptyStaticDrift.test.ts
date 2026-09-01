/**
 * Clear-screen / session_restored under the unified scroll architecture.
 * History shrink no longer triggers a CSI 2J self-heal; transcript rebuilds
 * in-place via React state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';
import {assertNoFullClear} from '../test-utils/ptyAssertions.js';

test('PTY clear-screen rebuilds transcript without static drift heal', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 30_000);
		await h.submit('自愈测试');
		await h.waitFor(() => h.transcript.includes('SELF-HEAL-TURN-1-DONE'), 'first turn completes', 30_000);

		const beforeClear = h.transcript.length;
		await h.submit('/clear-screen');
		await new Promise(resolve => setTimeout(resolve, 800));

		const screen = await h.screenText();
		assert.match(screen, /fast-ink|>|输入消息/, 'chrome still visible after clear-screen');
		assert.doesNotMatch(screen, /SELF-HEAL-TURN-1-DONE/, 'cleared transcript no longer shows old turn');
		assertNoFullClear(h.transcript.slice(beforeClear), 'clear-screen delta');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});

test('PTY session_restored empty turns rebuilds without CSI 2J self-heal', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 30_000);
		const before = h.transcript.length;

		// mock-engine "自愈测试" finishes the turn then emits session_restored
		// with empty turns — under the new pipeline this is a React rebuild,
		// not a refreshStatic full clear.
		await h.submit('自愈测试');
		await h.waitFor(() => h.transcript.includes('SELF-HEAL-TURN-1-DONE'), 'turn completes', 30_000);
		await new Promise(resolve => setTimeout(resolve, 1500));

		const delta = h.transcript.slice(before);
		assertNoFullClear(delta, 'session_restored path');

		const screen = await h.screenText();
		assert.match(screen, /fast-ink|>|输入消息|e2e:/, 'chrome remains after restore');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
