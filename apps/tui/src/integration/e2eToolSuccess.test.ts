/**
 * E2E: Tool success — shell command runs successfully, marker appears
 * in tool output with success indicator.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordedReplayHarness, gracefulExit, shellToolPrompt} from './helpers/e2eHarness.js';

test('E2E tool success: echo marker appears in output', {timeout: 300_000}, async t => {
	const marker = 'APPROVAL-OK-1782620793690';
	const h = await createRecordedReplayHarness(t, 'recorded-approval-approve.jsonl', {E2E_APPROVAL_MARKER: marker});
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);

		await h.submit(shellToolPrompt('printf "$E2E_APPROVAL_MARKER"'));

		await h.waitForScreen(/Do you want to proceed/, 'approval dialog', 120_000);
		h.write('y');

		await h.waitForScreen(marker, 'tool output marker', 120_000);

		await new Promise(resolve => setTimeout(resolve, 2000));

		const screen = await h.screenText();
		assert.match(screen, new RegExp(marker), 'marker in screen');
		const hasSuccess = screen.includes('✓') || screen.includes('success');
		assert.ok(hasSuccess, 'success indicator visible');
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
