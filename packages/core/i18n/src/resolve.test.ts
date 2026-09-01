import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizeLocale, resolveLocale} from './resolve.ts';

test('normalizeLocale maps Hans/Hant and pt', () => {
	assert.equal(normalizeLocale('zh-Hans-CN'), 'zh-CN');
	assert.equal(normalizeLocale('zh-Hant-TW'), 'zh-TW');
	assert.equal(normalizeLocale('zh-HK'), 'zh-TW');
	assert.equal(normalizeLocale('pt-PT'), 'pt-BR');
	assert.equal(normalizeLocale('en-US'), 'en');
	assert.equal(normalizeLocale('ja-JP'), 'ja');
	assert.equal(normalizeLocale('xx-YY'), 'en');
});

test('resolveLocale respects pin vs system', () => {
	assert.equal(resolveLocale('ja', 'en-US'), 'ja');
	assert.equal(resolveLocale('system', 'de-DE'), 'de');
	assert.equal(resolveLocale('system', 'sv-SE'), 'en');
});
