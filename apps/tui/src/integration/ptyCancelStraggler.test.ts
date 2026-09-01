/**
 * Full-chain ghost regression for the cancel-straggler storm (the /CancelRun
 * screenshot): replays ui-cancel-straggler.jsonl — a cancelled run followed by
 * leaked turnId-less thought/answer/tool events and repeated CancelRun ACKs —
 * through the real Ink UI in a true PTY, then parses the terminal buffer.
 *
 * The historical bug: every straggler resurfaced as its own "Thought" fragment
 * interleaved with a fresh "/CancelRun command result" box, over and over.
 * A healthy UI shows the pre-cancel content once, ONE cancel card, and nothing
 * ghostly after it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createReplayEngineHarness, gracefulExit} from './helpers/e2eHarness.js';

test('PTY cancel stragglers: no ghost thoughts, single CancelRun card', {timeout: 120_000}, async t => {
	const h = await createReplayEngineHarness(t, 'ui-cancel-straggler.jsonl', {
		// Let intermediate frames actually render so ghost frames CAN happen.
		FAST_REPLAY_EVENT_DELAY_MS: '40',
	});
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息，或 /help 查看命令'), 'ready prompt', 30_000);
		await h.submit('安装 libreoffice');

		// The pre-cancel stream must render (proves the replay reached the UI).
		await h.waitFor(() => h.transcript.includes('CancelRun'), 'cancel ACK card', 30_000);
		await h.waitForIdle(30_000);
		await new Promise(resolve => setTimeout(resolve, 800));

		// Stragglers must never have been painted, not even transiently.
		assert.ok(!h.transcript.includes('GHOST'),
			'post-cancel straggler content leaked into the terminal');

		const screen = await h.screenText();
		const cancelCards = screen.split('\n').filter(line => line.includes('CancelRun'));
		assert.equal(cancelCards.length, 1,
			`expected exactly one CancelRun card, saw ${cancelCards.length}:\n${cancelCards.join('\n')}`);

		// No agent row may keep spinning after the cancel.
		assert.ok(!screen.includes('风控员'), 'ghost agent row survived the cancel');
	} finally {
		if (!h.exited) {
			try { await gracefulExit(h); } catch { h.cleanup(); }
		}
	}
});
