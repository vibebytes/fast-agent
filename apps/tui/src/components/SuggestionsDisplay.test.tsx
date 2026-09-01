import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {SuggestionsDisplay} from './SuggestionsDisplay.js';
import {renderWithProviders, plainFrame} from '../test-utils/render.js';
import type {SuggestionState} from '../suggestions/SuggestionEngine.js';

function commandState(count: number, activeIndex = 0): SuggestionState {
	return {
		groups: [{
			title: 'Commands',
			items: Array.from({length: count}, (_, i) => ({
				value: `/cmd${String(i).padStart(2, '0')}`,
				label: `/cmd${String(i).padStart(2, '0')}`,
				description: `command ${i}`
			}))
		}],
		activeIndex,
		visible: true
	};
}

test('SuggestionsDisplay renders at most maxVisible items (window, not full list)', () => {
	const app = renderWithProviders(<SuggestionsDisplay state={commandState(40)} />);
	const frame = plainFrame(app.lastFrame());

	const itemRows = frame.split('\n').filter(line => /\/cmd\d\d/.test(line));
	assert.equal(itemRows.length, 8, `expected 8 visible items, saw ${itemRows.length}:\n${frame}`);
	assert.match(frame, /\/cmd00/, 'window starts at the top for activeIndex 0');
	assert.doesNotMatch(frame, /\/cmd20/, 'items outside the window must not render');
	assert.match(frame, /1\/40/, 'scroll indicator shows position/total');
	app.unmount();
});

test('SuggestionsDisplay window follows the active index', () => {
	const app = renderWithProviders(<SuggestionsDisplay state={commandState(40, 20)} />);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /❯ \/cmd20/, 'active item stays visible inside the window');
	assert.doesNotMatch(frame, /\/cmd00\b/, 'items far above the window are not rendered');
	assert.match(frame, /21\/40/, 'indicator reflects the active position');
	app.unmount();
});

test('SuggestionsDisplay window clamps at the end of the list', () => {
	const app = renderWithProviders(<SuggestionsDisplay state={commandState(40, 39)} />);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /❯ \/cmd39/, 'last item selectable and visible');
	const itemRows = frame.split('\n').filter(line => /\/cmd\d\d/.test(line));
	assert.equal(itemRows.length, 8, 'window stays at maxVisible when clamped to the end');
	app.unmount();
});

test('SuggestionsDisplay renders short lists fully without an indicator', () => {
	const app = renderWithProviders(<SuggestionsDisplay state={commandState(3)} />);
	const frame = plainFrame(app.lastFrame());

	const itemRows = frame.split('\n').filter(line => /\/cmd\d\d/.test(line));
	assert.equal(itemRows.length, 3);
	assert.doesNotMatch(frame, /navigate/, 'no scroll hint when everything fits');
	app.unmount();
});
