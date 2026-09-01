/**
 * E2E: Message queue — submit a second message while the first is running,
 * verify auto-dequeue after the first turn completes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordedReplayHarness, gracefulExit} from './helpers/e2eHarness.js';

test('E2E queue: second message auto-dequeues after first turn', {timeout: 300_000}, async t => {
	const h = await createRecordedReplayHarness(t, 'recorded-queue-auto-dequeue.jsonl', {FAST_REPLAY_EVENT_DELAY_MS: '8'});
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);

		await h.submit('第一条：设 A=`E2E-QUEUE-FIRST`，B=`-DONE`。最终回答只能包含 A 与 B 直接拼接后的字符串；禁止解释。');

		await h.waitFor(
			() => h.transcript.includes('Thinking'),
			'first turn thinking',
			60_000,
		);

		await h.submit('第二条：设 A=`E2E-QUEUE-SECOND`，B=`-DONE`。最终回答只能包含 A 与 B 直接拼接后的字符串；禁止解释。');

		await h.waitForScreen('E2E-QUEUE-FIRST-DONE', 'first turn final marker', 120_000);

		await h.waitForScreen('E2E-QUEUE-SECOND-DONE', 'second turn final marker', 120_000);

		await new Promise(resolve => setTimeout(resolve, 2000));

		const screen = await h.screenText();
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});

test('E2E queue: queued notice is visible while first turn is running', {timeout: 300_000}, async t => {
	const h = await createRecordedReplayHarness(t, 'recorded-queue-auto-dequeue.jsonl', {FAST_REPLAY_EVENT_DELAY_MS: '30'});
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);

		await h.submit('第一条：设 A=`E2E-QUEUE-FIRST`，B=`-DONE`。最终回答只能包含 A 与 B 直接拼接后的字符串；禁止解释。');
		await h.waitFor(() => h.transcript.includes('Thinking'), 'first turn thinking', 60_000);

		await h.submit('第二条：设 A=`E2E-QUEUE-SECOND`，B=`-DONE`。最终回答只能包含 A 与 B 直接拼接后的字符串；禁止解释。');

		await h.waitForScreen(/已排队|queue:1|queue>/, 'queued notice while first turn runs', 20_000);
		await h.waitForScreen('E2E-QUEUE-FIRST-DONE', 'first turn final marker', 120_000);
		await h.waitForScreen('E2E-QUEUE-SECOND-DONE', 'second turn final marker', 120_000);

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
