/**
 * Contract test for @jrichman/ink exports. Fails first when a fork upgrade
 * drops APIs we depend on for the unified scroll architecture.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import * as ink from 'ink';
import {renderToFrame} from './test-utils/frame.js';

test('ink fork exports the APIs required by the scroll architecture', () => {
	const requiredFns = [
		'render',
		'Static',
		'StaticRender',
		'renderToRegion',
		'useInput',
		'measureElement',
		'getScrollHeight',
		'getInnerHeight',
		'getScrollTop',
		'hitTest',
		'Selection',
		'Range'
	] as const;

	for (const name of requiredFns) {
		const value = (ink as Record<string, unknown>)[name];
		assert.ok(value !== undefined && value !== null, `missing export: ${name}`);
		assert.ok(
			typeof value === 'function' || typeof value === 'object',
			`export ${name} should be callable/constructible, got ${typeof value}`
		);
	}

	// React components may be forwardRef objects rather than plain functions.
	assert.ok(ink.Box, 'missing export: Box');
	assert.ok(ink.Text, 'missing export: Text');
	assert.ok(ink.ResizeObserver, 'missing export: ResizeObserver');
});

test('Box accepts scroll / sticky / scrollbar props without throwing', () => {
	const {Box, Text} = ink;
	const frame = renderToFrame(
		React.createElement(
			Box,
			{
				height: 5,
				width: 40,
				overflowY: 'scroll',
				scrollTop: 0,
				scrollbar: true,
				flexDirection: 'column'
			},
			React.createElement(
				Box,
				{sticky: 'top', opaque: true, height: 1},
				React.createElement(Text, null, 'HEADER')
			),
			React.createElement(Text, null, 'line 1'),
			React.createElement(Text, null, 'line 2'),
			React.createElement(Text, null, 'line 3')
		),
		{columns: 40, rows: 10}
	);
	assert.match(frame.plain, /HEADER/);
	assert.match(frame.plain, /line 1/);
});

test('StaticRender caches a block and exposes it in the frame', () => {
	const {Box, Text, StaticRender} = ink;
	const frame = renderToFrame(
		React.createElement(
			Box,
			{flexDirection: 'column', width: 40},
			React.createElement(StaticRender, {
				width: 40,
				deps: ['v1'],
				children: () => React.createElement(Text, null, 'FROZEN-BLOCK')
			})
		),
		{columns: 40, rows: 8}
	);
	assert.match(frame.plain, /FROZEN-BLOCK/);
});

test('renderToRegion returns a measurable Region', () => {
	const {Text, renderToRegion} = ink;
	const region = renderToRegion(React.createElement(Text, null, 'offline'), {width: 20});
	assert.ok(region);
	assert.ok(typeof region.height === 'number');
	assert.ok(region.height >= 1);
});
