/**
 * Chinese input + real terminal cursor: after typing CJK, @xterm/headless
 * cursor (driven by Ink terminalCursorFocus CUP) must sit on the composer
 * row at/after the input — the basis for IME candidate-box placement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';

test('ptyImeCursor: Chinese input places real cursor at composer end', {timeout: 60_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 30_000);

		const text = '你好世界';
		h.write(text);
		await h.waitFor(() => h.transcript.includes('你好'), 'chinese echo', 10_000);

		const screen = await h.screenText();
		assert.match(screen, /你好世界/, 'composer shows the typed CJK');

		const cursor = await h.cursorPosition();
		// Composer sits near the bottom; cursor must be on a lower row and past
		// the prompt ("> " ≈ 2 cols) into the CJK text (each char width 2).
		assert.ok(cursor.y >= 20, `cursor row should be near the bottom chrome, got y=${cursor.y}`);
		assert.ok(cursor.x >= 4, `cursor col should be past the prompt into the input, got x=${cursor.x}`);

		// Clear without submitting so we can exit cleanly.
		h.write('\u0015');
		await new Promise(resolve => setTimeout(resolve, 200));

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0);
	} finally {
		h.cleanup();
	}
});
