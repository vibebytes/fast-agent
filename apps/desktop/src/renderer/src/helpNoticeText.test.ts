import assert from 'node:assert/strict';
import test from 'node:test';
import {helpNoticeText} from './helpNoticeText.js';

const t = ((key: string) => {
	if (key === 'errors.send.empty_message') return 'Empty message.';
	if (key === 'errors.protocol.mismatch') return 'Protocol mismatch — engine events no longer parse. Reconnect or update.';
	return key;
}) as typeof import('i18next').t;

test('helpNoticeText translates protocol mismatch', () => {
	assert.equal(
		helpNoticeText('errors.protocol.mismatch', t),
		'Protocol mismatch — engine events no longer parse. Reconnect or update.'
	);
});

test('helpNoticeText passes through legacy bare messages', () => {
	assert.equal(helpNoticeText('Engine said no', t), 'Engine said no');
});

test('helpNoticeText empty', () => {
	assert.equal(helpNoticeText(null, t), '');
	assert.equal(helpNoticeText('', t), '');
});
