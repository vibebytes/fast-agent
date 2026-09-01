/**
 * E2E: Thinking/reasoning display — deepseek-reasoner naturally produces
 * reasoning_delta events, verify the Thinking indicator renders.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordedReplayHarness, gracefulExit} from './helpers/e2eHarness.js';

test('E2E thinking display: reasoning indicator appears during turn', {timeout: 300_000}, async t => {
	const h = await createRecordedReplayHarness(t, 'recorded-thinking-display.jsonl');
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);

		await h.submit('请分析一下 Scala 3 的主要新特性，简要列出 3 个；最后一行只输出由 `E2E-THINKING` 和 `-DONE` 拼接成的字符串。');

		await h.waitFor(
			async () => /Thought|Thinking/.test(await h.screenText()),
			'thinking indicator',
			60_000,
		);

		await h.waitForScreen('E2E-THINKING-DONE', 'assistant final marker', 120_000);

		await new Promise(resolve => setTimeout(resolve, 1000));

		const screen = await h.screenText();
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
