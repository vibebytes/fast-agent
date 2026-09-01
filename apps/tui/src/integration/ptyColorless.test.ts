/**
 * Mock-engine: NO_COLOR validation — with NO_COLOR=1, the parsed screen
 * text contains zero ANSI escape sequences.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';

test('PTY colorless: NO_COLOR=1 produces no ANSI escapes', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t, {NO_COLOR: '1', FORCE_COLOR: '0'});
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 30_000);

		await h.submit('hello colorless 测试');

		await h.waitFor(
			() => h.transcript.includes('SMOKE-FINAL-DONE'),
			'turn completes',
			30_000,
		);

		await new Promise(resolve => setTimeout(resolve, 500));

		const screen = await h.screenText();

		assert.doesNotMatch(screen, /\u001b\[/, 'no ANSI escape sequences in screen text');

		assert.match(screen, /SMOKE-FINAL-DONE/, 'final answer visible');
		assert.match(screen, /SMOKE-TOOL-LINE/, 'tool output visible');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
