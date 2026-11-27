import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionSettleSchemas} from './protocol/sessionSettle.js';

test('follow_up_changed accepts legacy notice and optional correlation IDs', () => {
	const schema = sessionSettleSchemas[0]!;
	const legacy = schema.parse({
		type: 'follow_up_changed',
		paused: false,
		itemsJson: '[]',
		notice: 'temporary busy'
	});
	assert.equal(legacy.notice, 'temporary busy');
	assert.equal(legacy.noticeItemId, undefined);
	assert.equal(legacy.noticeClientMessageId, undefined);

	const modern = schema.parse({
		type: 'follow_up_changed',
		paused: false,
		itemsJson: '[]',
		notice: 'temporary busy',
		noticeItemId: 'fu-1',
		noticeClientMessageId: 'cmid-1'
	});
	assert.equal(modern.noticeItemId, 'fu-1');
	assert.equal(modern.noticeClientMessageId, 'cmid-1');
});
