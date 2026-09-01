import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadCustomThemes, loadSavedThemeName, saveThemeName, mergeTheme, loadSavedRendererMode, saveRendererMode} from './themeStore.js';
import {defaultDarkTheme, resolveTheme, hasTheme} from './semanticTheme.js';

function withTempHome<T>(callback: (home: string) => T): T {
	const home = mkdtempSync(path.join(tmpdir(), 'fast-ink-theme-'));
	const previous = process.env.HOME;
	process.env.HOME = home;
	try {
		return callback(home);
	} finally {
		process.env.HOME = previous;
	}
}

test('mergeTheme deep-merges a partial patch over the base', () => {
	const merged = mergeTheme(defaultDarkTheme, {
		text: {accent: '#FF00FF'},
		spinner: ['#FF00FF']
	});
	assert.equal(merged.text.accent, '#FF00FF');
	assert.equal(merged.text.primary, defaultDarkTheme.text.primary);
	assert.deepEqual(merged.spinner, ['#FF00FF']);
	assert.equal(merged.status.success, defaultDarkTheme.status.success);
});

test('theme name round-trips through ui-settings.json', () => {
	withTempHome(() => {
		assert.equal(loadSavedThemeName(), undefined);
		saveThemeName('dracula');
		assert.equal(loadSavedThemeName(), 'dracula');
		saveThemeName('nord');
		assert.equal(loadSavedThemeName(), 'nord');
	});
});

test('renderer mode round-trips and coexists with the theme setting', () => {
	withTempHome(() => {
		assert.equal(loadSavedRendererMode(), undefined);
		saveThemeName('nord');
		saveRendererMode('fullscreen');
		assert.equal(loadSavedRendererMode(), 'fullscreen');
		// Both keys survive in the same settings file.
		assert.equal(loadSavedThemeName(), 'nord');
		saveRendererMode('inline');
		assert.equal(loadSavedRendererMode(), 'inline');
	});
});

test('custom JSON themes register from ~/.fast/themes', () => {
	withTempHome(home => {
		const dir = path.join(home, '.fast', 'themes');
		mkdirSync(dir, {recursive: true});
		writeFileSync(path.join(dir, 'my-brand.json'), JSON.stringify({
			extends: 'dracula',
			text: {accent: '#123456'}
		}));
		writeFileSync(path.join(dir, 'broken.json'), '{not json');

		const loaded = loadCustomThemes();
		assert.ok(loaded.includes('my-brand'));
		assert.ok(!loaded.includes('broken'));
		assert.ok(hasTheme('my-brand'));
		const theme = resolveTheme('my-brand');
		assert.equal(theme.text.accent, '#123456');
		// Inherited from the dracula base, not default-dark.
		assert.equal(theme.status.success, resolveTheme('dracula').status.success);
	});
});
