/**
 * Transcript component tests using renderToFrame for controlled terminal size.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {Box, Text, StaticRender} from 'ink';
import {renderToFrame} from '../test-utils/frame.js';
import {initialScrollState, reduceScroll} from './transcriptScroll.js';

test('viewport taller content: stick-to-bottom keeps the latest lines', () => {
	let scroll = initialScrollState(10, 40);
	assert.equal(scroll.scrollTop, 30);
	scroll = reduceScroll(scroll, {type: 'content', scrollHeight: 50});
	assert.equal(scroll.scrollTop, 40);
});

test('StaticRender freezes content across re-renders with stable deps', () => {
	const frame1 = renderToFrame(
		React.createElement(
			Box,
			{width: 40, flexDirection: 'column'},
			React.createElement(StaticRender, {
				width: 40,
				deps: ['item-1', 'default-dark'],
				children: () => React.createElement(Text, null, 'SETTLED-A')
			}),
			React.createElement(Text, null, 'LIVE-TAIL')
		),
		{columns: 40, rows: 8}
	);
	assert.match(frame1.plain, /SETTLED-A/);
	assert.match(frame1.plain, /LIVE-TAIL/);

	const frame2 = renderToFrame(
		React.createElement(
			Box,
			{width: 40, flexDirection: 'column'},
			React.createElement(StaticRender, {
				width: 40,
				deps: ['item-1', 'default-dark'],
				children: () => React.createElement(Text, null, 'SETTLED-A')
			}),
			React.createElement(Text, null, 'LIVE-TAIL-2')
		),
		{columns: 40, rows: 8}
	);
	assert.match(frame2.plain, /SETTLED-A/);
	assert.match(frame2.plain, /LIVE-TAIL-2/);
});

test('themeName dep change re-renders StaticRender content', () => {
	const frameDark = renderToFrame(
		React.createElement(StaticRender, {
			width: 40,
			deps: ['item-1', 'default-dark'],
			children: () => React.createElement(Text, {color: 'cyan'}, 'THEMED-DARK')
		}),
		{columns: 40, rows: 4}
	);
	const frameLight = renderToFrame(
		React.createElement(StaticRender, {
			width: 40,
			deps: ['item-1', 'default-light'],
			children: () => React.createElement(Text, {color: 'blue'}, 'THEMED-LIGHT')
		}),
		{columns: 40, rows: 4}
	);
	assert.match(frameDark.plain, /THEMED-DARK/);
	assert.match(frameLight.plain, /THEMED-LIGHT/);
});

test('non-sticking growth leaves scrollTop unchanged', () => {
	let scroll = initialScrollState(10, 50);
	scroll = reduceScroll(scroll, {type: 'scrollBy', delta: -5});
	assert.equal(scroll.isSticking, false);
	const top = scroll.scrollTop;
	scroll = reduceScroll(scroll, {type: 'content', scrollHeight: 80});
	assert.equal(scroll.scrollTop, top);
});
