/**
 * Sticky header contract: Box accepts sticky/opaque/stickyChildren and
 * renders the title without throwing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {Box, Text} from 'ink';
import {renderToFrame} from '../test-utils/frame.js';

test('Box sticky/opaque/stickyChildren props render without throwing', () => {
	const frame = renderToFrame(
		React.createElement(
			Box,
			{width: 40, flexDirection: 'column'},
			React.createElement(
				Box,
				{
					sticky: 'top',
					opaque: true,
					height: 1,
					stickyChildren: React.createElement(Text, null, 'STICKY-SHORT')
				},
				React.createElement(Text, null, 'STICKY-TITLE')
			),
			React.createElement(Text, null, 'body-line-0'),
			React.createElement(Text, null, 'body-line-1')
		),
		{columns: 40, rows: 10}
	);
	assert.match(frame.plain, /STICKY-TITLE|STICKY-SHORT/);
	assert.match(frame.plain, /body-line-0/);
});
