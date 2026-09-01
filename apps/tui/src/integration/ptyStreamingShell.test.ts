/**
 * Mock-engine: live shell output streaming — while a long command runs the
 * card must show a live tail of the incoming lines plus a ticking elapsed
 * counter; when the tool finishes, the authoritative <tool_result…> output
 * replaces the streamed preview and the card settles without tearing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';

test('PTY streaming shell: live tail + elapsed while running, clean settle after', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 30_000);

		await h.submit('慢速流式安装测试');

		// Mid-run: streamed lines surface in the running card as they arrive.
		await h.waitForScreen(/STREAM-LINE-1/, 'first streamed line visible while running', 15_000);
		await h.waitForScreen(/STREAM-LINE-[3-6]/, 'later streamed lines keep flowing', 15_000);
		const midScreen = await h.screenText();
		assert.match(midScreen, /\$ npm install --verbose\s+\d+s/, 'elapsed seconds tick in the running header');

		// Completion: the turn finishes and the final observation replaces the
		// raw streamed lines (no duplicated content).
		await h.waitFor(() => h.transcript.includes('STREAM-TURN-DONE'), 'turn completes', 30_000);
		await new Promise(resolve => setTimeout(resolve, 500));
		const screen = await h.screenText();
		assert.match(screen, /STREAM-FINAL added 6 packages/, 'authoritative final output visible');
		assert.match(screen, /3\.3s/, 'final duration replaces the live counter');
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes');

		// Card borders stay intact on the settled card (no torn rows).
		// PTY/xterm may append a block cursor (█) after the closing border.
		const stripPtyChrome = (line: string) => line.replace(/[█▀▄]+$/g, '').trimEnd();
		const cardRows = screen.split('\n').filter(line => line.includes('STREAM-FINAL'));
		for (const row of cardRows) {
			assert.match(stripPtyChrome(row), /^\s*│.*│\s*$/, `card row lost its border: "${row}"`);
		}

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
