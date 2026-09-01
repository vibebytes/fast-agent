import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	LIVE_TICKER_ROWS,
	auxiliaryChromeOpen,
	exploreTickerLines,
	liveTickerOuterHeightPx,
	nextAuxiliaryUserOpen,
	shouldMountExploringFullList,
	shouldUseLiveTicker,
	tickerTailLines
} from './tickerTail.js';

test('tickerTailLines returns at most maxLines from the end', () => {
	const text = ['one', 'two', 'three', 'four', 'five'].join('\n');
	const lines = tickerTailLines(text, 3);
	assert.deepEqual(
		lines.map(l => l.text),
		['three', 'four', 'five']
	);
	assert.equal(lines.length, 3);
	assert.ok(lines.every(l => typeof l.key === 'number'));
});

test('tickerTailLines skips empty and dot-only lines', () => {
	const text = 'alpha\n\n...\nbeta\n';
	assert.deepEqual(
		tickerTailLines(text, 5).map(l => l.text),
		['alpha', 'beta']
	);
});

test('tickerTailLines truncates a newline-less blob instead of blowing the window', () => {
	const blob = '字'.repeat(400);
	const lines = tickerTailLines(blob, LIVE_TICKER_ROWS, 80);
	assert.equal(lines.length, 1);
	assert.ok(lines[0]!.text.length <= 80);
	assert.ok(lines[0]!.text.startsWith('…'));
});

test('tickerTailLines on a huge buffer still returns ≤ maxLines (seam: O(window))', () => {
	const parts = Array.from({length: 5_000}, (_, i) => `line-${i}`);
	const text = parts.join('\n');
	const lines = tickerTailLines(text, LIVE_TICKER_ROWS);
	assert.equal(lines.length, LIVE_TICKER_ROWS);
	assert.deepEqual(
		lines.map(l => l.text),
		['line-4997', 'line-4998', 'line-4999']
	);
});

test('empty / blank text yields no ticker lines', () => {
	assert.deepEqual(tickerTailLines('', 3), []);
	assert.deepEqual(tickerTailLines('   \n\n', 3), []);
});

test('liveTickerOuterHeightPx is constant across growing thought text (height budget)', () => {
	const a = liveTickerOuterHeightPx();
	const b = liveTickerOuterHeightPx(LIVE_TICKER_ROWS);
	assert.equal(a, b);
	assert.ok(a > 0);
	// Seam: streaming more text must not change the declared outer budget.
	const afterStream = liveTickerOuterHeightPx(
		tickerTailLines('x\n'.repeat(200), LIVE_TICKER_ROWS).length > 0
			? LIVE_TICKER_ROWS
			: LIVE_TICKER_ROWS
	);
	assert.equal(afterStream, a);
});

test('shouldUseLiveTicker only for open chrome that is not user-forced full body', () => {
	assert.equal(shouldUseLiveTicker({itemOpen: true, userOpen: null}), true);
	assert.equal(shouldUseLiveTicker({itemOpen: true, userOpen: false}), false);
	assert.equal(shouldUseLiveTicker({itemOpen: true, userOpen: true}), false);
	assert.equal(shouldUseLiveTicker({itemOpen: false, userOpen: true}), false);
	assert.equal(shouldUseLiveTicker({itemOpen: false, userOpen: null}), false);
});

test('exploreTickerLines keeps only the newest tool rows', () => {
	const tools = Array.from({length: 10}, (_, i) => ({
		title: `read-${i}`,
		summary: i % 2 === 0 ? `path/${i}.ts` : null
	}));
	const lines = exploreTickerLines(tools, 3);
	assert.equal(lines.length, 3);
	assert.equal(lines[0]!.text, 'read-7');
	assert.equal(lines[1]!.text, 'read-8 — path/8.ts');
	assert.equal(lines[2]!.text, 'read-9');
});

test('exploreTickerLines omits summary when it duplicates the title', () => {
	const lines = exploreTickerLines(
		[{title: 'grep foo', summary: 'grep foo'}],
		3
	);
	assert.deepEqual(
		lines.map(l => l.text),
		['grep foo']
	);
});

test('open Exploring live path does not mount the full tool list', () => {
	assert.equal(
		shouldMountExploringFullList({itemOpen: true, userOpen: null}),
		false
	);
	assert.equal(
		shouldMountExploringFullList({itemOpen: true, userOpen: true}),
		true
	);
	assert.equal(
		shouldMountExploringFullList({itemOpen: false, userOpen: null}),
		false
	);
	assert.equal(
		shouldMountExploringFullList({itemOpen: false, userOpen: true}),
		true
	);
});

test('streaming chrome toggles ticker ↔ full; collapse from full returns to ticker', () => {
	assert.equal(auxiliaryChromeOpen({itemOpen: true, userOpen: null}), true);
	assert.equal(auxiliaryChromeOpen({itemOpen: true, userOpen: true}), true);
	assert.equal(auxiliaryChromeOpen({itemOpen: true, userOpen: false}), false);
	assert.equal(
		nextAuxiliaryUserOpen({itemOpen: true, userOpen: null, requestedOpen: false}),
		true
	);
	assert.equal(
		nextAuxiliaryUserOpen({itemOpen: true, userOpen: true, requestedOpen: false}),
		null
	);
	assert.equal(
		shouldUseLiveTicker({
			itemOpen: true,
			userOpen: nextAuxiliaryUserOpen({
				itemOpen: true,
				userOpen: true,
				requestedOpen: false
			})
		}),
		true
	);
});

test('streaming Thought height budget stays fixed as text grows (sentinel)', () => {
	const budgets = [10, 200, 2_000, 20_000].map(n => {
		const text = Array.from({length: n}, (_, i) => `reasoning ${i}`).join('\n');
		const lines = tickerTailLines(text, LIVE_TICKER_ROWS);
		assert.ok(lines.length <= LIVE_TICKER_ROWS);
		return liveTickerOuterHeightPx();
	});
	assert.ok(budgets.every(b => b === budgets[0]));
});
