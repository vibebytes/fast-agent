/**
 * PTY E2E: Esc cancels a running task — honoring the "Esc 取消" hint shown
 * next to the spinner. Approval prompts must keep their own Esc semantics.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';

test('PTY Esc cancel: Esc mid-stream cancels the run and returns to idle', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitForScreen('输入消息，或 /help 查看命令', 'ready prompt', 30_000);

		// Long-running scenario gives us a wide cancel window.
		await h.submit('深度分析系统');
		await h.waitForScreen(/Thinking|深度分析步骤/, 'turn is streaming', 30_000);

		const before = h.transcript.length;
		h.write('\u001B');

		await h.waitFor(
			() => h.transcript.slice(before).includes('e2e:normal:idle'),
			'idle state after Esc cancel',
			15_000
		);

		// The run was cancelled — its final answer must never arrive.
		await h.expectScreenStaysGone('GHOST-FINAL-DONE', 'cancelled final answer', 2_000);

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'app should exit cleanly after Esc cancel');
	} finally {
		h.cleanup();
	}
});

test('PTY Esc during approval: denies the approval instead of cancelling the run', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitForScreen('输入消息，或 /help 查看命令', 'ready prompt', 30_000);

		await h.submit('需要审批的操作');
		await h.waitForScreen('Do you want to proceed', 'approval dialog', 30_000);
		await new Promise(resolve => setTimeout(resolve, 300));

		h.write('\u001B');

		// Esc = deny: the tool must not run, and the turn ends without success.
		await h.expectScreenStaysGone('APPROVAL-TOOL-DONE', 'denied tool output', 3_000);
		await h.waitForIdle();

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'app should exit cleanly');
	} finally {
		h.cleanup();
	}
});
