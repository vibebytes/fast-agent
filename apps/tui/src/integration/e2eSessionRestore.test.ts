/**
 * E2E: Session restore — complete a turn, exit, relaunch with the same HOME,
 * verify history is visible and a new turn can be submitted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordedReplayHarness, gracefulExit} from './helpers/e2eHarness.js';

test('E2E session restore: history visible after relaunch', {timeout: 300_000}, async t => {
	const h1 = await createRecordedReplayHarness(t, 'recorded-session-restore.jsonl');
	if (!h1) return;

	const restorePrefix = 'RESTORE-MARKER-1782623633689';
	const RESTORE_MARKER = `${restorePrefix}-DONE`;
	const sharedHome = h1.home;

	try {
		await h1.waitFor(() => h1.transcript.includes('输入消息'), 'ready prompt', 120_000);

		await h1.submit(`请只回复由 \`${restorePrefix}\` 和 \`-DONE\` 拼接成的字符串，不要添加其他内容。`);

		await h1.waitForScreen(RESTORE_MARKER, 'first turn final marker', 120_000);

		await new Promise(resolve => setTimeout(resolve, 2000));
		const exitCode1 = await gracefulExit(h1);
		assert.equal(exitCode1, 0, 'first session exits cleanly');
	} finally {
		h1.cleanup();
	}

	const h2 = await createRecordedReplayHarness(
		t,
		'recorded-session-restore.jsonl',
		{
			FAST_REPLAY_START_AT_SESSION_RESTORED: '1',
			FAST_REPLAY_NEXT_TURN_TEXT: '恢复后继续对话',
		},
		{home: sharedHome, sessionMode: 'continue'}
	);
	if (!h2) return;

	try {
		await h2.waitFor(() => h2.transcript.includes('输入消息'), 'ready prompt (second launch)', 120_000);

		await new Promise(resolve => setTimeout(resolve, 3000));

		const screen = await h2.screenText();
		const hasHistory = screen.includes(RESTORE_MARKER) || h2.transcript.includes(RESTORE_MARKER);
		assert.ok(hasHistory, 'history marker visible after session restore');

		const continueMarker = 'RESTORE-CONTINUE-DONE';
		await h2.submit('恢复后继续对话：设 A=`RESTORE-CONTINUE`，B=`-DONE`。最终回答只能包含 A 与 B 直接拼接后的字符串；禁止解释。');
		await h2.waitForScreen(continueMarker, 'new turn final marker after restore', 120_000);

		const exitCode2 = await gracefulExit(h2);
		assert.equal(exitCode2, 0, 'second session exits cleanly');
	} finally {
		h2.cleanup();
	}
});
