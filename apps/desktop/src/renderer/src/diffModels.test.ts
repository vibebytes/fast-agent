import assert from 'node:assert/strict';
import test from 'node:test';
import {createDiffModels} from './diffModels';

test('creates independent original and modified model objects with their own text', () => {
	const models = createDiffModels(
		(value: string, language: string) => ({value, language}),
		'HEAD text',
		'worktree text',
		'tsx'
	);
	assert.notEqual(models.original, models.modified);
	assert.deepEqual(models.original, {value: 'HEAD text', language: 'tsx'});
	assert.deepEqual(models.modified, {value: 'worktree text', language: 'tsx'});
});
