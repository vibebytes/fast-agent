/**
 * E2E: Shell approval deny — user presses 'n' or Esc, dialog disappears,
 * tool does not run, turn ends.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordedReplayHarness, gracefulExit, shellToolPrompt} from './helpers/e2eHarness.js';

test('E2E approval deny (n): dialog disappears, tool does not run', {timeout: 300_000}, async t => {
	const marker = 'DENY-BLOCKED-RECORDED';
	const h = await createRecordedReplayHarness(t, 'recorded-approval-deny-n.jsonl', {E2E_DENY_MARKER: marker});
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);

		await h.submit(shellToolPrompt('printf "$E2E_DENY_MARKER"'));

		await h.waitForScreen(/Do you want to proceed/, 'approval dialog', 120_000);

		h.write('n');

		await new Promise(resolve => setTimeout(resolve, 5000));

		const screen = await h.screenText();
		assert.doesNotMatch(screen, new RegExp(marker), 'tool output should not appear after deny');
		assert.doesNotMatch(screen, /Do you want to proceed/, 'dialog gone');
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});

test('E2E approval deny (Esc): same behavior as n', {timeout: 300_000}, async t => {
	const marker = 'ESC-BLOCKED-RECORDED';
	const h = await createRecordedReplayHarness(t, 'recorded-approval-deny-n.jsonl', {E2E_DENY_MARKER: marker});
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);

		await h.submit(shellToolPrompt('printf "$E2E_DENY_MARKER"'));

		await h.waitForScreen(/Do you want to proceed/, 'approval dialog', 120_000);

		h.write('\u001b');

		await new Promise(resolve => setTimeout(resolve, 5000));

		const screen = await h.screenText();
		assert.doesNotMatch(screen, new RegExp(marker), 'tool output should not appear after Esc deny');
		assert.doesNotMatch(screen, /Do you want to proceed/, 'dialog gone after Esc');
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});

test('E2E approval: Composer submit blocked during pending approval', {timeout: 300_000}, async t => {
	const marker = 'BLOCKED-TEST-1782621064206';
	const h = await createRecordedReplayHarness(t, 'recorded-approval-blocked-submit.jsonl', {E2E_BLOCKED_MARKER: marker});
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);

		await h.submit(shellToolPrompt('printf "$E2E_BLOCKED_MARKER"'));

		await h.waitForScreen(/Do you want to proceed/, 'approval dialog', 120_000);

		h.write('some random text\r');
		await h.waitForScreen(/Approval is pending/, 'pending approval notice', 30_000);

		const blockedScreen = await h.screenText();
		assert.match(blockedScreen, /Do you want to proceed/, 'approval dialog still pending after blocked submit');
		assert.doesNotMatch(blockedScreen, new RegExp(marker), 'blocked submit must not run approval tool');

		await new Promise(resolve => setTimeout(resolve, 300));
		h.write('y');

		await h.waitForScreen(marker, 'tool output after approval', 120_000);

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});

test('E2E approval deny (n): next user message can run after dialog clears', {timeout: 300_000}, async t => {
	const deniedMarker = 'DENY-RECOVERY-BLOCKED-RECORDED';
	const recoveryMarker = 'DENY-RECOVERY-DONE';
	const h = await createRecordedReplayHarness(t, 'recorded-approval-deny-recovery.jsonl', {E2E_DENY_RECOVERY_BLOCKED: deniedMarker});
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);
		await h.submit(shellToolPrompt('printf "$E2E_DENY_RECOVERY_BLOCKED"'));
		await h.waitForScreen(/Do you want to proceed/, 'approval dialog', 120_000);

		h.write('n');
		await h.waitForScreenGone(/Do you want to proceed/, 'dialog gone after deny', 120_000);
		await h.expectScreenStaysGone(new RegExp(deniedMarker), 'denied tool output', 3_000);
		await h.waitForIdle();

		await h.submit('恢复检查：设 A=`DENY-RECOVERY`，B=`-DONE`。最终回答只能包含 A 与 B 直接拼接后的字符串；禁止解释。');
		await h.waitForScreen(recoveryMarker, 'recovery final marker after deny', 120_000);

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});

test('E2E approval deny (Esc): next user message can run after dialog clears', {timeout: 300_000}, async t => {
	const deniedMarker = 'DENY-RECOVERY-BLOCKED-RECORDED';
	const recoveryMarker = 'DENY-RECOVERY-DONE';
	const h = await createRecordedReplayHarness(t, 'recorded-approval-deny-recovery.jsonl', {E2E_DENY_RECOVERY_BLOCKED: deniedMarker});
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);
		await h.submit(shellToolPrompt('printf "$E2E_DENY_RECOVERY_BLOCKED"'));
		await h.waitForScreen(/Do you want to proceed/, 'approval dialog', 120_000);

		h.write('\u001b');
		await h.waitForScreenGone(/Do you want to proceed/, 'dialog gone after Esc', 120_000);
		await h.expectScreenStaysGone(new RegExp(deniedMarker), 'Esc-denied tool output', 3_000);
		await h.waitForIdle();

		await h.submit('恢复检查：设 A=`DENY-RECOVERY`，B=`-DONE`。最终回答只能包含 A 与 B 直接拼接后的字符串；禁止解释。');
		await h.waitForScreen(recoveryMarker, 'recovery final marker after Esc deny', 120_000);

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
