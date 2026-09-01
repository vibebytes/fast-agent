/**
 * Mock-engine: command_result rendering — success / error / decided statuses
 * are correctly rendered in the TUI.
 *
 * Also verifies that command_result(decided) does NOT clear an active
 * approval dialog — only approval_resolved does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';

test('PTY command_result: success / error / decided render correctly', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 30_000);

		await h.submit('command结果测试');

		await h.waitFor(
			() => h.transcript.includes('CMD-RESULT-FINAL-DONE'),
			'turn completes',
			30_000,
		);

		await new Promise(resolve => setTimeout(resolve, 500));

		const screen = await h.screenText();

		assert.match(screen, /CMD-RESULT-SUCCESS-MARKER/, 'success command_result visible');
		assert.match(screen, /CMD-RESULT-ERROR-MARKER/, 'error command_result visible');
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});

test('PTY command_result(decided): approval stays pending in compact submitting state', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 30_000);

		await h.submit('延迟审批测试');

		await h.waitForScreen(/Do you want to proceed/, 'approval dialog', 30_000);

		h.write('y');

		// Optimistic echo: the dialog collapses to its compact submitting row
		// immediately, without waiting for any engine response. The engine ACKs
		// via command_result(decided) at once, while approval_resolved lags 800ms —
		// during that window the submitting row must persist and the decided
		// card must NOT enter the transcript.
		await h.waitForScreen(/已选择 Yes/, 'compact submitting state', 5_000);
		const screenMid = await h.screenText();
		assert.match(screenMid, /已选择 Yes/, 'submitting state persists through command_result(decided)');
		assert.doesNotMatch(screenMid, /DECIDED-BEFORE-RESOLVED/, 'DecideApproval ACK is routed to the dialog, not the transcript');

		// Wait for the delayed approval_resolved + tool execution.
		await h.waitFor(
			() => h.transcript.includes('APPROVAL-TOOL-DONE'),
			'tool execution after delayed resolution',
			15_000,
		);

		await new Promise(resolve => setTimeout(resolve, 500));
		const screenAfter = await h.screenText();
		assert.doesNotMatch(screenAfter, /Do you want to proceed/, 'dialog gone after approval_resolved');
		assert.doesNotMatch(screenAfter, /已选择 Yes ·/, 'submitting row gone after approval_resolved');
		assert.doesNotMatch(screenAfter, /\u001b\[/, 'no raw ANSI escapes');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});

test('PTY approval blackhole: one DecideApproval only + 10s escalation warning', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 30_000);

		await h.submit('黑洞审批测试');
		await h.waitForScreen(/Do you want to proceed/, 'approval dialog', 30_000);

		// Hammer the confirm key: the original bug produced one zombie
		// DecideApproval per press. The dialog must debounce to exactly one.
		h.write('y');
		await h.waitForScreen(/已选择 Yes/, 'compact submitting state', 5_000);
		h.write('y');
		h.write('y');
		h.write('\r');

		await h.waitFor(() => h.transcript.includes('DECIDE-RECEIVED-1'), 'first decide reached engine', 10_000);
		await new Promise(resolve => setTimeout(resolve, 1_000));
		assert.ok(!h.transcript.includes('DECIDE-RECEIVED-2'), 'repeat presses must not reach the engine');

		// approval_resolved never arrives → escalation warning within ~10s.
		await h.waitForScreen(/引擎未确认审批/, 'escalation warning after 10s', 20_000);
		const screen = await h.screenText();
		assert.match(screen, /r 重发/, 'escalated state offers resend');
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes');

		// The run is wedged by design (blackhole never resolves), so a graceful
		// idle exit is impossible — the harness kills the PTY in cleanup().
	} finally {
		h.cleanup();
	}
});
