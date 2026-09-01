import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	resolveSidebarColor,
	sinkOklchLightness,
	withSidebar,
	SIDEBAR_LIGHT_SINK_L
} from './applyPalette.js';

test('sinkOklchLightness lowers L by the light-plane step', () => {
	assert.equal(sinkOklchLightness('oklch(1 0 0)'), `oklch(${1 - SIDEBAR_LIGHT_SINK_L} 0 0)`);
	assert.equal(sinkOklchLightness('oklch(0.99 0.002 240)'), 'oklch(0.97 0.002 240)');
});

test('sinkOklchLightness passes through non-oklch', () => {
	assert.equal(sinkOklchLightness('#f5f5f5'), '#f5f5f5');
});

test('resolveSidebarColor: light sinks from background when sidebar missing', () => {
	const color = resolveSidebarColor({background: 'oklch(1 0 0)'}, 'light');
	assert.equal(color, 'oklch(0.98 0 0)');
});

test('resolveSidebarColor: light sinks from card when background missing', () => {
	assert.equal(
		resolveSidebarColor({card: 'oklch(0.99 0 0)'}, 'light'),
		'oklch(0.97 0 0)'
	);
});

test('resolveSidebarColor: light keeps explicit sidebar', () => {
	const color = resolveSidebarColor(
		{background: 'oklch(1 0 0)', sidebar: 'oklch(0.95 0 0)'},
		'light'
	);
	assert.equal(color, 'oklch(0.95 0 0)');
});

test('resolveSidebarColor: dark does not sink (card ?? background)', () => {
	assert.equal(
		resolveSidebarColor({background: 'oklch(0.14 0 0)', card: 'oklch(0.21 0 0)'}, 'dark'),
		'oklch(0.21 0 0)'
	);
	assert.equal(
		resolveSidebarColor({background: 'oklch(0.14 0 0)'}, 'dark'),
		'oklch(0.14 0 0)'
	);
});

test('withSidebar light sinks muted into a clearer sidebar-accent', () => {
	const vars = withSidebar({background: 'oklch(1 0 0)', muted: 'oklch(0.967 0 0)'}, 'light');
	assert.equal(vars['sidebar-accent'], 'oklch(0.917 0 0)');
});
