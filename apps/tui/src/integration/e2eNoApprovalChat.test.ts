import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordedReplayHarness, gracefulExit} from './helpers/e2eHarness.js';

test('E2E no approval: normal chat completes without approval dialog', {timeout: 300_000}, async t => {
	const marker = 'E2E-NO-APPROVAL-DONE';
	const h = await createRecordedReplayHarness(t, 'recorded-no-approval-chat.jsonl');
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);

		await h.submit('普通对话测试：不要调用任何工具。请只回复由 `E2E-NO-APPROVAL` 和 `-DONE` 拼接成的字符串，不要添加其他内容。');
		await h.expectScreenStaysGone(/Do you want to proceed/, 'approval dialog during normal chat', 5_000);
		await h.waitForScreen(marker, 'normal chat final marker', 120_000);

		const screen = await h.screenText();
		assert.doesNotMatch(screen, /Do you want to proceed/, 'normal chat should not show approval dialog');
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
