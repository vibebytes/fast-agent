import test from 'node:test';
import assert from 'node:assert/strict';
import {getThemeNames, resolveTheme, hasTheme} from './semanticTheme.js';

test('at least 6 built-in truecolor themes plus ansi/no-color fallbacks', () => {
	const names = getThemeNames();
	assert.ok(names.length >= 8, `expected >= 8 themes, got ${names.length}: ${names.join(', ')}`);
	for (const required of ['default-dark', 'default-light', 'dracula', 'gruvbox-dark', 'nord', 'solarized-light', 'ansi', 'no-color']) {
		assert.ok(hasTheme(required), `missing built-in theme ${required}`);
	}
});

test('every theme provides every semantic token', () => {
	for (const name of getThemeNames()) {
		const theme = resolveTheme(name);
		const flatTokens: Array<[string, string]> = [
			...Object.entries(theme.text).map(([key, value]) => [`text.${key}`, value] as [string, string]),
			...Object.entries(theme.status).map(([key, value]) => [`status.${key}`, value] as [string, string]),
			...Object.entries(theme.border).map(([key, value]) => [`border.${key}`, value] as [string, string]),
			...Object.entries(theme.background).map(([key, value]) => [`background.${key}`, value] as [string, string]),
			...Object.entries(theme.tool).map(([key, value]) => [`tool.${key}`, value] as [string, string]),
			...Object.entries(theme.dialog).map(([key, value]) => [`dialog.${key}`, value] as [string, string]),
			[`diff.addedFg`, theme.diff.addedFg],
			[`diff.removedFg`, theme.diff.removedFg]
		];
		for (const [token, value] of flatTokens) {
			assert.ok(typeof value === 'string' && value.length > 0, `${name}: token ${token} is empty`);
		}
		assert.ok(theme.spinner.length > 0, `${name}: spinner gradient empty`);
	}
});

test('truecolor themes use hex colors; degraded themes use named colors', () => {
	for (const name of ['default-dark', 'default-light', 'dracula', 'gruvbox-dark', 'nord', 'solarized-light']) {
		const theme = resolveTheme(name);
		assert.match(theme.text.accent, /^#[0-9A-Fa-f]{6}$/, `${name} accent should be hex`);
		assert.ok(theme.diff.addedBg, `${name} should provide a diff added background`);
		assert.ok(theme.diff.removedBg, `${name} should provide a diff removed background`);
	}
	// 16-color and no-color themes degrade diff to prefix-only (no backgrounds).
	for (const name of ['ansi', 'no-color']) {
		const theme = resolveTheme(name);
		assert.equal(theme.diff.addedBg, undefined, `${name} must not use diff backgrounds`);
	}
});

test('resolveTheme falls back to default-dark for unknown names', () => {
	assert.equal(resolveTheme('nope-not-a-theme'), resolveTheme('default-dark'));
});
