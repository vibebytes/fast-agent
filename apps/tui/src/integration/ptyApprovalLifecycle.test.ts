import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';

test('PTY approval lifecycle: turn_finished clears unresolved approval dialog', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 30_000);

		await h.submit('未resolved审批测试');
		await h.waitForScreen(/Do you want to proceed/, 'approval dialog', 30_000);
		await h.waitForScreenGone(/Do you want to proceed/, 'approval dialog cleared by turn_finished', 10_000);

		await new Promise(resolve => setTimeout(resolve, 1000));
		const screen = await h.screenText();
		assert.doesNotMatch(screen, /Do you want to proceed/, 'approval dialog gone after turn_finished');
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
