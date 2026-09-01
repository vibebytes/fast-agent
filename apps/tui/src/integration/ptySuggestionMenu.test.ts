/**
 * PTY regression: the "/" suggestion menu must render a WINDOW (≤ maxVisible
 * items), never the full command list — and must not trigger a full-clear
 * dump under the terminalBuffer / incrementalRendering pipeline.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockEngineHarness, gracefulExit} from './helpers/e2eHarness.js';
import {assertNoFullClear} from '../test-utils/ptyAssertions.js';

test('PTY suggestion menu: "/" renders a window, no fullscreen clear-dump', {timeout: 120_000}, async t => {
	const h = await createMockEngineHarness(t);
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息，或 /help 查看命令'), 'ready prompt', 30_000);

		const beforeSlash = h.transcript.length;
		h.write('/');
		await h.waitFor(() => h.transcript.slice(beforeSlash).includes('-- Commands --'), 'suggestion menu', 10_000);
		await new Promise(resolve => setTimeout(resolve, 400));

		const screen = await h.screenText();
		const itemRows = screen.split('\n').filter(line => /(❯\s+)?\/[a-z][a-z-]*\s{2}\S/.test(line));
		assert.ok(itemRows.length > 0, `menu items should be visible; screen:\n${screen.slice(-2000)}`);
		assert.ok(itemRows.length <= 8, `menu must be windowed to 8 items, saw ${itemRows.length}:\n${itemRows.join('\n')}`);
		assert.match(screen, /1\/\d{2}/, 'scroll indicator with total count is shown');
		assert.doesNotMatch(screen, /\/yolo\s{2}/, 'items far outside the window must not render');

		for (let index = 0; index < 12; index++) {
			h.write('\u001B[B');
			await new Promise(resolve => setTimeout(resolve, 60));
		}
		const screenAfterNav = await h.screenText();
		const navRows = screenAfterNav.split('\n').filter(line => /(❯\s+)?\/[a-z][a-z-]*\s{2}\S/.test(line));
		assert.ok(navRows.length <= 8, `windowed after navigation, saw ${navRows.length} rows`);
		assert.match(screenAfterNav, /13\/\d{2}/, 'indicator follows the active index');

		assertNoFullClear(h.transcript.slice(beforeSlash), 'suggestion menu open');

		// Banner should not be duplicated into the visible frame by a clear-dump.
		const bannerCount = screen.match(/fast-ink v/g)?.length ?? 0;
		assert.ok(bannerCount <= 1, `startup banner must not duplicate, saw ${bannerCount}`);

		h.write('\u001B');
		await new Promise(resolve => setTimeout(resolve, 200));
		h.write('\u001B');
		await new Promise(resolve => setTimeout(resolve, 200));

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
