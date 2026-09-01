/**
 * E2E: Cancel mid-stream — Ctrl+C while the engine is streaming,
 * verify late rendered content does not leak and the app recovers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordedReplayHarness, gracefulExit} from './helpers/e2eHarness.js';

test('E2E cancel: Ctrl+C mid-stream blocks late events', {timeout: 300_000}, async t => {
	const h = await createRecordedReplayHarness(t, 'recorded-cancel-recovery.jsonl', {FAST_REPLAY_EVENT_DELAY_MS: '12'});
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);

		await h.submit('请详细解释 React 18 的并发模式原理，至少 500 字；最后一行只输出由 `E2E-CANCEL-LATE` 和 `-SHOULD-NOT-RENDER` 拼接成的字符串。');

		await h.waitFor(
			() => h.transcript.includes('Thinking'),
			'thinking indicator',
			60_000,
		);

		await new Promise(resolve => setTimeout(resolve, 500));
		h.write('\u0003');

		await new Promise(resolve => setTimeout(resolve, 3000));

		await h.expectScreenStaysGone('E2E-CANCEL-LATE-SHOULD-NOT-RENDER', 'late final marker after cancel', 10_000);

		const screen = await h.screenText();
		assert.doesNotMatch(screen, /E2E-CANCEL-LATE-SHOULD-NOT-RENDER/, 'late final marker should not render after cancel');
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes');

		await h.submit('恢复检查：请只回复由 `E2E-CANCEL-RECOVERY` 和 `-DONE` 拼接成的字符串，不要添加其他内容。');
		await h.waitForScreen('E2E-CANCEL-RECOVERY-DONE', 'recovery turn final marker', 120_000);

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
