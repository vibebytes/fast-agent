/**
 * Theme switch should not emit a full-screen clear (CSI 2J/3J).
 * Under the scroll architecture, StaticRender deps=[themeName] recolor
 * settled history without refreshStatic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';
import {assertNoFullClear} from '../test-utils/ptyAssertions.js';

test('ptyThemeSwitch: theme change does not full-clear', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 30_000);
		await h.submit('command结果');
		await h.waitFor(() => /command|结果|DONE|done|Mock/i.test(h.transcript), 'turn settles', 30_000);

		const beforeLen = h.transcript.length;
		await h.submit('/theme');
		await new Promise(resolve => setTimeout(resolve, 500));
		h.write('\r');
		await new Promise(resolve => setTimeout(resolve, 800));

		assertNoFullClear(h.transcript.slice(beforeLen), 'theme switch delta');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0);
	} finally {
		h.cleanup();
	}
});
