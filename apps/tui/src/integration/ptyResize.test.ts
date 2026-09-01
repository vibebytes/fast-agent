/**
 * Mid-session resize should not dump duplicate history via full clears.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';
import {assertNoFullClear} from '../test-utils/ptyAssertions.js';

test('ptyResize: shrink then grow without full-clear dump', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 30_000);
		await h.submit('command结果');
		await h.waitFor(() => h.transcript.length > 200, 'some output', 30_000);

		const before = h.transcript.length;
		h.resize(60, 20);
		await new Promise(resolve => setTimeout(resolve, 500));
		h.resize(100, 30);
		await new Promise(resolve => setTimeout(resolve, 500));

		assertNoFullClear(h.transcript.slice(before), 'resize delta');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0);
	} finally {
		h.cleanup();
	}
});
