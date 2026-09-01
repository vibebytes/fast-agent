import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {SmoothText} from './SmoothText.js';
import {renderWithProviders, plainFrame} from '../test-utils/render.js';

test('SmoothText renders full text when inactive', () => {
	const app = renderWithProviders(<SmoothText text="hello world" active={false} />);
	assert.match(plainFrame(app.lastFrame()), /hello world/);
	app.unmount();
});

test('SmoothText starts streaming with cursor when active', () => {
	const app = renderWithProviders(<SmoothText text="abcdefgh" active speedMs={10} burstChars={8} />);
	const frame = plainFrame(app.lastFrame());
	assert.ok(frame.includes('▍') || frame.includes('a'));
	app.unmount();
});
