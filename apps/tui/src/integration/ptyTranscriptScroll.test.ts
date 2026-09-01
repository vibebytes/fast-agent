/**
 * PTY: PgUp during streaming freezes the viewport (not stick); End restores follow.
 * Uses a short terminal so stream output overflows the scroll viewport.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';

const PAGE_UP = '\u001b[5~';
const END = '\u001b[F';

test('ptyTranscriptScroll: PgUp freezes view during stream; End restores follow', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t, undefined, {cols: 80, rows: 16});
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 30_000);
		await h.submit('慢速流式安装测试');

		await h.waitForScreen(/STREAM-LINE-1/, 'first streamed line', 15_000);

		// Leave stick-to-bottom while later lines are still arriving (~500ms each).
		h.write(PAGE_UP);
		h.write(PAGE_UP);
		await h.waitForScreen(/已上翻/, 'scrolled-up hint after PgUp', 5_000);

		// Hold the frozen viewport across the remaining trickle (lines 2–6).
		await new Promise(resolve => setTimeout(resolve, 2800));
		const mid = await h.screenText();
		assert.match(mid, /已上翻/, 'must stay non-sticking while new output arrives');
		assert.doesNotMatch(mid, /STREAM-LINE-6/, 'non-sticking viewport must not jump to newest line');

		h.write(END);
		await h.waitForScreenGone(/已上翻/, 'End clears scrolled-up hint', 5_000);

		await h.waitFor(
			() => h.transcript.includes('STREAM-TURN-DONE') || h.transcript.includes('e2e:normal:idle'),
			'turn settles',
			30_000
		);
		await h.waitForScreen(/STREAM-FINAL|STREAM-TURN-DONE|STREAM-LINE/, 'follow restored to latest', 10_000);

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0);
	} finally {
		h.cleanup();
	}
});
