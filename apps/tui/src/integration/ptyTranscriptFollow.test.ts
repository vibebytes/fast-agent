/**
 * PTY: long streaming output should stick to bottom without full clears.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';
import {assertNoFullClear, assertSynchronizedFrames} from '../test-utils/ptyAssertions.js';

test('ptyTranscriptFollow: long stream sticks without full clear', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 30_000);
		await h.submit('慢速流式安装测试');

		await h.waitForScreen(/STREAM-LINE-1/, 'first streamed line', 15_000);
		await h.waitFor(() => h.transcript.includes('STREAM-TURN-DONE'), 'turn completes', 30_000);

		assertNoFullClear(h.transcript, 'follow stream');
		assertSynchronizedFrames(h.transcript, 'follow stream');

		const screen = await h.screenText();
		assert.match(screen, /STREAM-FINAL|STREAM-LINE/, 'latest stream content visible');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0);
	} finally {
		h.cleanup();
	}
});
