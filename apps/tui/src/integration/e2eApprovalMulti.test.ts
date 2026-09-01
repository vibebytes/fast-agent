/**
 * E2E: Multiple approvals in one turn — LLM calls two shell commands
 * sequentially, each requiring separate approval.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createReplayEngineHarness, gracefulExit, shellToolSequencePrompt} from './helpers/e2eHarness.js';

test('E2E multi-approval: two shell calls, two approvals', {timeout: 300_000}, async t => {
	const marker1 = `MULTI-STEP-1-${Date.now()}`;
	const marker2 = `MULTI-STEP-2-${Date.now()}`;
	const h = await createReplayEngineHarness(
		t,
		'approval-multi.jsonl',
		{
			E2E_MULTI_STEP_1: marker1,
			E2E_MULTI_STEP_2: marker2,
		}
	);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);

		await h.submit(shellToolSequencePrompt([
			'printf "$E2E_MULTI_STEP_1"',
			'printf "$E2E_MULTI_STEP_2"',
		]));

		await h.waitForScreen(/Do you want to proceed/, 'first approval dialog', 120_000);
		await new Promise(resolve => setTimeout(resolve, 300));
		h.write('y');

		await h.waitForScreen(marker1, 'first marker in output', 120_000);
		// Match the second dialog by its unique command text: the generic
		// "Do you want to proceed" phrase also lives in dialog #1's scrollback,
		// so it can fire before dialog #2 actually rendered — a premature `y`
		// would then be (correctly) swallowed by dialog #1's submitting state.
		await h.waitForScreen(marker2, 'second approval dialog', 120_000);
		await new Promise(resolve => setTimeout(resolve, 300));
		h.write('y');
		await h.waitForScreen(new RegExp(`\\$ printf "${marker2}"`), 'second command executed as a tool', 120_000);

		await new Promise(resolve => setTimeout(resolve, 5000));

		const screen = await h.screenText();
		assert.match(screen, new RegExp(marker1), 'first marker visible');
		assert.match(screen, new RegExp(marker2), 'second marker visible');
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
