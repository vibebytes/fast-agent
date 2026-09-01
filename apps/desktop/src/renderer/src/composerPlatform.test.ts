import assert from 'node:assert/strict';
import test from 'node:test';
import {platformModel} from './composerPlatform.js';

test('platformModel prefers display platform and id model segment', () => {
	assert.deepEqual(
		platformModel({id: 'openrouter/claude-sonnet-4', display: 'openrouter/claude-sonnet-4'}),
		{platform: 'openrouter', model: 'claude-sonnet-4'}
	);
});

test('platformModel falls back when display lacks slash', () => {
	assert.deepEqual(platformModel({id: 'deepseek', display: 'DeepSeek'}), {
		platform: 'deepseek',
		model: 'deepseek'
	});
});
