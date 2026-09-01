import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {RUNNING_THINKING_ROWS, ThinkingBlock} from './ThinkingBlock.js';
import {renderWithProviders, plainFrame} from '../test-utils/render.js';

test('RUNNING_THINKING_ROWS is the Live Ticker product budget (4)', () => {
	assert.equal(RUNNING_THINKING_ROWS, 4);
});

test('ThinkingBlock renders nothing when finished with empty text', () => {
	const app = renderWithProviders(
		<ThinkingBlock text="" running={false} />
	);
	const frame = plainFrame(app.lastFrame());

	assert.equal(frame, '');
	app.unmount();
});

test('ThinkingBlock renders Thought header when finished with content', () => {
	const app = renderWithProviders(
		<ThinkingBlock text="Analyzing the problem carefully" running={false} />
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /Thought/);
	assert.match(frame, /Analyzing the problem carefully/);
	app.unmount();
});

test('ThinkingBlock caps body rows during streaming', () => {
	const longText = Array.from({length: 20}, (_, i) => `Line ${i + 1} of reasoning content`).join('\n');
	const app = renderWithProviders(
		<ThinkingBlock text={longText} running />
	);
	const frame = plainFrame(app.lastFrame());

	const visibleLines = frame.split('\n').filter(l => /Line \d+ of reasoning/.test(l));
	assert.ok(
		visibleLines.length <= RUNNING_THINKING_ROWS,
		`Expected at most ${RUNNING_THINKING_ROWS} visible content lines, got ${visibleLines.length}`
	);
	assert.ok(visibleLines.length >= 1, 'expected some reasoning lines to remain visible');
	// Newest lines remain; oldest of the 20 are clamped away.
	assert.match(frame, /Line 20 of reasoning/);
	assert.doesNotMatch(frame, /Line 1 of reasoning/);
	app.unmount();
});

test('ThinkingBlock replaces Thinking header with waitLabel while running', () => {
	const app = renderWithProviders(
		<ThinkingBlock text="" running waitLabel="Reconnecting (1/2)" />
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /Reconnecting \(1\/2\)/);
	assert.doesNotMatch(frame, /\bThinking\b/);
	app.unmount();
});
