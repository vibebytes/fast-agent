import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readLocalePref, systemTagFromNavigator} from './localePref.ts';

test('readLocalePref defaults to system for null/invalid', () => {
	assert.equal(readLocalePref(null), 'system');
	assert.equal(readLocalePref(''), 'system');
	assert.equal(readLocalePref('nope'), 'system');
	assert.equal(readLocalePref('sv'), 'system');
});

test('readLocalePref accepts system and pinned locales', () => {
	assert.equal(readLocalePref('system'), 'system');
	assert.equal(readLocalePref('ja'), 'ja');
	assert.equal(readLocalePref('zh-CN'), 'zh-CN');
	assert.equal(readLocalePref('pt-BR'), 'pt-BR');
});

test('systemTagFromNavigator falls back to en without navigator', () => {
	const prev = globalThis.navigator;
	// @ts-expect-error test override
	delete globalThis.navigator;
	try {
		assert.equal(systemTagFromNavigator(), 'en');
	} finally {
		Object.defineProperty(globalThis, 'navigator', {
			value: prev,
			configurable: true,
			writable: true
		});
	}
});
