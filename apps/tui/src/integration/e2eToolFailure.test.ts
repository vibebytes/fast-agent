/**
 * E2E: Tool failure — shell command fails (nonexistent command),
 * failure marker (✗) appears in output.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordedReplayHarness, gracefulExit, shellToolPrompt} from './helpers/e2eHarness.js';

test('E2E tool failure: nonexistent command shows failure marker', {timeout: 300_000}, async t => {
	const h = await createRecordedReplayHarness(t, 'recorded-tool-failure.jsonl');
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);

		await h.submit(shellToolPrompt('nonexistent_cmd_xyz_12345'));

		await h.waitForScreen(/Do you want to proceed/, 'approval dialog', 120_000);
		h.write('y');

		await h.waitForScreen(/not found|✗|failed|失败/i, 'failure indicator or error output', 120_000);

		await new Promise(resolve => setTimeout(resolve, 2000));

		const screen = await h.screenText();
		const hasFailure = screen.includes('✗') || screen.includes('not found') || screen.includes('failed') || screen.includes('失败');
		assert.ok(hasFailure, 'failure marker or error message visible');
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});

test('E2E tool failure: next user message succeeds after failed shell command', {timeout: 300_000}, async t => {
	const recoveryMarker = 'TOOL-FAILURE-RECOVERY-DONE';
	const h = await createRecordedReplayHarness(t, 'recorded-tool-failure-recovery.jsonl');
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);
		await h.submit(shellToolPrompt('nonexistent_cmd_xyz_67890'));
		await h.waitForScreen(/Do you want to proceed/, 'approval dialog', 120_000);
		h.write('y');

		await h.waitForScreen(/not found|✗|failed|失败/i, 'failure indicator or error output', 120_000);
		await h.waitForScreenGone(/Do you want to proceed/, 'approval dialog gone after failed tool', 120_000);

		await h.submit('失败恢复检查：设 A=`TOOL-FAILURE-RECOVERY`，B=`-DONE`。最终回答只能包含 A 与 B 直接拼接后的字符串；禁止解释。');
		await h.waitForScreen(recoveryMarker, 'recovery final marker after tool failure', 120_000);

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
