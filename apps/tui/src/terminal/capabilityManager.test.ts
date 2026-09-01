import test from 'node:test';
import assert from 'node:assert/strict';
import {detectTerminalCapabilities, effectiveWidth, shouldUseAlternateBuffer} from './capabilityManager.js';

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(patch)) {
		previous.set(key, process.env[key]);
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	try {
		return run();
	} finally {
		for (const [key, value] of previous.entries()) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}

function withStdoutProps<T>(patch: Partial<Record<'columns' | 'rows' | 'isTTY', number | boolean>>, run: () => T): T {
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries(patch)) {
		previous.set(key, Object.getOwnPropertyDescriptor(process.stdout, key));
		Object.defineProperty(process.stdout, key, {
			value,
			configurable: true,
			enumerable: true,
			writable: true
		});
	}
	try {
		return run();
	} finally {
		for (const [key, descriptor] of previous.entries()) {
			if (descriptor) {
				Object.defineProperty(process.stdout, key, descriptor);
			} else {
				delete (process.stdout as unknown as Record<string, unknown>)[key];
			}
		}
	}
}

test('detectTerminalCapabilities returns sane defaults', () => {
	const caps = detectTerminalCapabilities();
	assert.ok(caps.width >= 20);
	assert.ok(caps.height >= 1);
});

test('effectiveWidth reserves margin', () => {
	const caps = detectTerminalCapabilities();
	assert.equal(effectiveWidth({...caps, width: 80}, 2), 78);
});

test('detectTerminalCapabilities supports terminal dimension matrix', () => {
	const widths = [40, 72, 120, 200];
	const heights = [12, 24, 48];

	for (const width of widths) {
		for (const height of heights) {
			const caps = withEnv(
				{NO_COLOR: undefined, FORCE_COLOR: undefined, TERM: 'xterm-256color', FAST_SCREEN_READER: undefined},
				() => withStdoutProps({columns: width, rows: height, isTTY: true}, () => detectTerminalCapabilities())
			);
			assert.equal(caps.width, width);
			assert.equal(caps.height, height);
			assert.equal(caps.unicode, true);
			assert.equal(caps.dumbTerminal, false);
			assert.equal(caps.noColor, false);
		}
	}
});

test('detectTerminalCapabilities capability matrix handles no-color and dumb terminal modes', () => {
	const noColorCaps = withEnv(
		{NO_COLOR: '1', FORCE_COLOR: undefined, TERM: 'xterm-256color', FAST_SCREEN_READER: undefined},
		() => withStdoutProps({columns: 100, rows: 30, isTTY: true}, () => detectTerminalCapabilities())
	);
	assert.equal(noColorCaps.noColor, true);
	assert.equal(noColorCaps.colorDepth, 1);
	assert.equal(noColorCaps.unicode, true);

	const forceNoColorCaps = withEnv(
		{NO_COLOR: undefined, FORCE_COLOR: '0', TERM: 'xterm-256color', FAST_SCREEN_READER: undefined},
		() => withStdoutProps({columns: 100, rows: 30, isTTY: true}, () => detectTerminalCapabilities())
	);
	assert.equal(forceNoColorCaps.noColor, true);
	assert.equal(forceNoColorCaps.colorDepth, 1);

	const dumbCaps = withEnv(
		{NO_COLOR: undefined, FORCE_COLOR: undefined, TERM: 'dumb', FAST_SCREEN_READER: undefined},
		() => withStdoutProps({columns: 90, rows: 20, isTTY: true}, () => detectTerminalCapabilities())
	);
	assert.equal(dumbCaps.dumbTerminal, true);
	assert.equal(dumbCaps.unicode, false);
});

test('shouldUseAlternateBuffer respects screen-reader and height thresholds', () => {
	const base = withEnv(
		{NO_COLOR: undefined, FORCE_COLOR: undefined, TERM: 'xterm-256color', FAST_SCREEN_READER: undefined},
		() => withStdoutProps({columns: 100, rows: 30, isTTY: true}, () => detectTerminalCapabilities())
	);
	assert.equal(shouldUseAlternateBuffer(base), true);

	const shortScreen = {...base, height: 20};
	assert.equal(shouldUseAlternateBuffer(shortScreen), false);

	const screenReaderCaps = withEnv(
		{NO_COLOR: undefined, FORCE_COLOR: undefined, TERM: 'xterm-256color', FAST_SCREEN_READER: '1'},
		() => withStdoutProps({columns: 100, rows: 30, isTTY: true}, () => detectTerminalCapabilities())
	);
	assert.equal(screenReaderCaps.screenReader, true);
	assert.equal(shouldUseAlternateBuffer(screenReaderCaps), false);
});
