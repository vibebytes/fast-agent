import assert from 'node:assert/strict';
import test from 'node:test';
import {projectEntryToTimelineItems} from './timeline.js';
import type {TranscriptEntry} from './transcriptProjection.js';

test('user timeline item strips merged <env>/<query> for display', () => {
	const entry: TranscriptEntry = {
		id: 'u1',
		role: 'user',
		text: `<env>
  <cwd>/proj</cwd>
</env>

<query>
show path
</query>`,
		status: 'done',
		turnId: 't1'
	};
	const items = projectEntryToTimelineItems(entry, undefined);
	assert.equal(items.length, 1);
	assert.equal(items[0]?.kind, 'user');
	if (items[0]?.kind === 'user') {
		assert.equal(items[0].text, 'show path');
		assert.equal(items[0].text.includes('<env>'), false);
	}
});
