import assert from 'node:assert/strict';
import test from 'node:test';
import type {ContextUsageView} from '@fast-ide/session-view';
import {
	buildMeterRingGeometry,
	buildMeterPillLabel,
	buildBreakdownSegments,
	computeCacheFreshness,
	formatCompactElapsed,
	formatUsageCost,
	PROMPT_CACHE_IDLE_TTL_MS
} from './ContextUsageMeter.js';

const sampleView: ContextUsageView = {
	usedTokens: 45_200,
	contextWindow: 128_000,
	contextBudget: 96_000,
	percent: 35,
	level: 'normal',
	inputTokens: 45_200,
	outputTokens: 3_400,
	cacheReadTokens: 38_000,
	cacheWriteTokens: 0,
	totalTokens: 48_600,
	cacheHitPercent: 84,
	breakdown: [
		{key: 'system', tokens: 5_200, percent: 4.1},
		{key: 'tools', tokens: 8_000, percent: 6.3},
		{key: 'summary', tokens: 2_000, percent: 1.6},
		{key: 'messages', tokens: 30_000, percent: 23.4}
	]
};

test('buildMeterRingGeometry computes stroke circumference and offset from percent', () => {
	const g0 = buildMeterRingGeometry(0, 14, 2);
	assert.equal(g0.radius, 6);
	assert.ok(Math.abs(g0.circumference - 2 * Math.PI * 6) < 0.001);
	assert.ok(Math.abs(g0.dashOffset - g0.circumference) < 0.001);

	const g50 = buildMeterRingGeometry(50, 14, 2);
	assert.ok(Math.abs(g50.dashOffset - g50.circumference * 0.5) < 0.001);

	const gOver = buildMeterRingGeometry(130, 14, 2);
	assert.equal(gOver.dashOffset, 0);
});

test('buildMeterPillLabel formats compact percentage and token ratio', () => {
	const label = buildMeterPillLabel(sampleView);
	assert.equal(label.percentText, '35%');
	assert.equal(label.ratioText, '45.2k / 128k');

	const noWindow = buildMeterPillLabel({
		...sampleView,
		contextWindow: undefined,
		percent: undefined
	});
	assert.equal(noWindow.percentText, null);
	assert.equal(noWindow.ratioText, '45.2k');
});

test('buildBreakdownSegments normalizes non-zero context buckets against contextWindow', () => {
	const segments = buildBreakdownSegments(sampleView);
	assert.equal(segments.length, 4);
	assert.deepEqual(
		segments.map(s => s.key),
		['system', 'tools', 'summary', 'messages']
	);
	const totalShare = segments.reduce((acc, s) => acc + s.windowSharePercent, 0);
	assert.ok(totalShare > 34 && totalShare < 36);
});

test('formatUsageCost reads costAmount/costCurrency and the legacy cost key', () => {
	assert.equal(formatUsageCost({costAmount: '0.0042', costCurrency: 'USD'}), '0.0042 USD');
	assert.equal(formatUsageCost({costAmount: '0.0042'}), '0.0042');
	assert.equal(formatUsageCost({cost: '$0.0042'}), '$0.0042');
	assert.equal(formatUsageCost({}), null);
	assert.equal(formatUsageCost({costAmount: '', costCurrency: 'USD'}), null);
	assert.equal(formatUsageCost(undefined), null);
});

test('formatCompactElapsed and computeCacheFreshness track active streak, rebuild, and TTL expiry', () => {
	assert.equal(formatCompactElapsed(12_000), '12s');
	assert.equal(formatCompactElapsed(140_000), '2m 20s');
	assert.equal(formatCompactElapsed(720_000), '12m');
	assert.equal(formatCompactElapsed(3_900_000), '1h 5m');

	const baseNow = 1_700_000_000_000;
	const active = computeCacheFreshness(
		{
			...sampleView,
			cacheStatus: 'hit',
			cacheHitStreak: 4,
			cacheStartedAt: baseNow - 180_000,
			lastCacheHitAt: baseNow - 30_000
		},
		baseNow
	);
	assert.ok(active);
	assert.equal(active.status, 'hit');
	assert.equal(active.streak, 4);
	assert.equal(active.idleElapsedMs, 30_000);
	assert.equal(active.activeSpanMs, 180_000);
	assert.equal(active.likelyExpired, false);

	const expired = computeCacheFreshness(
		{
			...sampleView,
			cacheStatus: 'hit',
			cacheHitStreak: 2,
			lastCacheHitAt: baseNow - PROMPT_CACHE_IDLE_TTL_MS - 5_000
		},
		baseNow
	);
	assert.equal(expired?.likelyExpired, true);

	const cold = computeCacheFreshness(
		{
			...sampleView,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			cacheStatus: 'miss'
		},
		baseNow
	);
	assert.equal(cold, null);
});

