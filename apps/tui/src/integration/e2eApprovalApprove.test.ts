/**
 * E2E: Shell approval approve — prompt triggers shell tool, user approves,
 * tool runs, dialog disappears, final answer arrives.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordedReplayHarness, gracefulExit, shellToolPrompt} from './helpers/e2eHarness.js';

test('E2E approval approve: shell tool → approve → tool runs → dialog disappears', {timeout: 300_000}, async t => {
	const marker = 'APPROVAL-OK-1782620793690';
	const h = await createRecordedReplayHarness(t, 'recorded-approval-approve.jsonl', {E2E_APPROVAL_MARKER: marker});
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);

		await h.submit(shellToolPrompt('printf "$E2E_APPROVAL_MARKER"'));

		await h.waitForScreen(/Do you want to proceed/, 'approval dialog', 120_000);

		const screenBefore = await h.screenText();
		assert.match(screenBefore, /Do you want to proceed/, 'approval dialog visible before decision');

		h.write('y');

		await h.waitForScreen(marker, 'tool output with marker', 120_000);

		await new Promise(resolve => setTimeout(resolve, 5000));
		const screen = await h.screenText();
		assert.match(screen, new RegExp(marker), 'tool output marker visible on screen');
		assert.doesNotMatch(screen, /Do you want to proceed/, 'approval dialog gone after resolution');
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
