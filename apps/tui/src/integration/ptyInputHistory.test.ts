/**
 * PTY E2E: Input history — after a completed turn, ↑ recalls the previous
 * message into the composer, and Esc clears it again.
 *
 * Regression guard: history navigation used to be dead code (the ↑ key
 * resolved to MOVE_UP while the composer listened for an unreachable
 * HISTORY_UP), so this must be verified through a real terminal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';

test('PTY input history: ↑ recalls last message, Esc clears it', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitForScreen('输入消息，或 /help 查看命令', 'ready prompt', 30_000);

		await h.submit('历史回溯冒烟消息');
		await h.waitForScreen('SMOKE-FINAL-DONE', 'turn finished', 30_000);
		await h.waitForIdle();

		// Recall from history: the composer input row must show the text again.
		h.write('\u001B[A');
		await h.waitForScreen(/│ > 历史回溯冒烟消息/, 'history entry recalled into composer', 10_000);

		// Esc clears the recalled input (idle, so no run-cancel side effect).
		h.write('\u001B');
		await h.waitForScreenGone(/│ > 历史回溯冒烟消息/, 'composer cleared after Esc', 10_000);

		// Recall again and submit — the recalled text must actually round-trip.
		h.write('\u001B[A');
		await h.waitForScreen(/│ > 历史回溯冒烟消息/, 'history entry recalled again', 10_000);
		h.write('\r');
		await h.waitFor(async () => {
			const screen = await h.screenText();
			return (screen.match(/SMOKE-FINAL-DONE/g) ?? []).length >= 2;
		}, 'second turn from recalled entry', 30_000);
		await h.waitForIdle();

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'app should exit cleanly');
	} finally {
		h.cleanup();
	}
});
