/**
 * E2E smoke: boots the real TUI + Scala engine + deepseek-reasoner,
 * submits a simple prompt, verifies the turn completes with thinking +
 * assistant output, then exits cleanly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordedReplayHarness, gracefulExit} from './helpers/e2eHarness.js';

test('E2E smoke: real engine + deepseek-reasoner completes a turn', {timeout: 300_000}, async t => {
	const h = await createRecordedReplayHarness(t, 'recorded-smoke.jsonl');
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);

		await h.submit('hello，请只回复由 `E2E-SMOKE` 和 `-DONE` 拼接成的字符串，不要添加其他内容。');

		await h.waitForScreen(/Thought|Thinking/, 'thinking indicator', 60_000);

		await h.waitForScreen('E2E-SMOKE-DONE', 'assistant final marker', 120_000);

		await new Promise(resolve => setTimeout(resolve, 1000));

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'app should exit cleanly');

		const screen = await h.screenText();
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes in parsed screen');
	} finally {
		h.cleanup();
	}
});
