/**
 * PTY: /tui toggles alternate buffer via Ink setOptions (?1049h / ?1049l).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';
import {assertAltBufferToggle} from '../test-utils/ptyAssertions.js';

test('ptyModeSwitch: /tui toggles alt buffer three times without residue', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 30_000);

		for (let i = 0; i < 3; i++) {
			await h.submit('/tui fullscreen');
			await h.waitFor(() => h.transcript.includes('\u001b[?1049h') || h.transcript.includes('1049h'), `enter alt ${i}`, 10_000);
			await h.submit('/tui inline');
			await h.waitFor(() => (h.transcript.match(/\u001b\[\?1049l/g) ?? []).length >= i + 1, `leave alt ${i}`, 10_000);
		}

		assertAltBufferToggle(h.transcript, 1);
		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0);
	} finally {
		h.cleanup();
	}
});
