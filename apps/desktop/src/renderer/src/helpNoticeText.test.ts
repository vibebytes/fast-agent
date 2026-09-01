import assert from 'node:assert/strict';
import test from 'node:test';
import {helpNoticeText} from './helpNoticeText.js';

const t = ((key: string) => {
	if (key === 'errors.send.empty_message') return 'Empty message.';
	return key;
}) as typeof import('i18next').t;

test('helpNoticeText translates catalog keys', () => {
	assert.equal(helpNoticeText('errors.send.empty_message', t), 'Empty message.');
});

test('helpNoticeText passes through legacy bare messages', () => {
	assert.equal(helpNoticeText('Engine said no', t), 'Engine said no');
});

test('helpNoticeText empty', () => {
	assert.equal(helpNoticeText(null, t), '');
	assert.equal(helpNoticeText('', t), '');
});
