import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseRecommendedLabel} from './QuestionBatchCard.js';

test('parseRecommendedLabel strips conventional suffixes for display only', () => {
	assert.deepEqual(parseRecommendedLabel('Fast (Recommended)'), {
		label: 'Fast',
		recommended: true
	});
	assert.deepEqual(parseRecommendedLabel('稳妥（推荐）'), {label: '稳妥', recommended: true});
	assert.deepEqual(parseRecommendedLabel('稳妥 (推荐)'), {label: '稳妥', recommended: true});
	assert.deepEqual(parseRecommendedLabel('Plain'), {label: 'Plain', recommended: false});
});
