/**
 * PTY E2E: Clarify flow — the engine asks a free-text clarification
 * question mid-run; the composer switches to answer mode ("答:"), the typed
 * answer resolves the clarification and the turn completes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';

test('PTY clarify: engine question → typed answer → turn completes', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitForScreen('输入消息，或 /help 查看命令', 'ready prompt', 30_000);

		await h.submit('这个需求需要澄清一下');
		await h.waitForScreen('CLARIFY-QUESTION-MARKER', 'clarify question shown', 30_000);
		await h.waitForScreen(/答:/, 'composer switches to clarify mode', 10_000);
		await new Promise(resolve => setTimeout(resolve, 300));

		await h.submit('使用JSON格式');
		await h.waitForScreen('CLARIFY-FINAL-DONE', 'turn completes after answer', 30_000);
		assert.match(await h.screenText(), /收到答复：使用JSON格式/, 'answer round-trips to the engine');
		await h.waitForIdle();

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'app should exit cleanly');
	} finally {
		h.cleanup();
	}
});

test('PTY run failure: run_failed surfaces the error and returns to idle', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitForScreen('输入消息，或 /help 查看命令', 'ready prompt', 30_000);

		await h.submit('这个操作必然失败');
		await h.waitForScreen('RUN-FAILED-MARKER', 'run failure surfaced to the user', 30_000);
		await h.waitForIdle();

		// A failed run must not lock the composer: a follow-up turn still works.
		await h.submit('失败后继续对话');
		await h.waitForScreen('SMOKE-FINAL-DONE', 'follow-up turn after failure', 30_000);
		await h.waitForIdle();

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'app should exit cleanly');
	} finally {
		h.cleanup();
	}
});
