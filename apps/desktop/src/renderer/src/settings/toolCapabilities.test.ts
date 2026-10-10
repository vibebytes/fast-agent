import assert from 'node:assert/strict';
import test from 'node:test';
import {
	CAPABILITY_TAGS,
	EDITABLE_CAPABILITY_TAGS,
	hasCapability,
	type ModelCapabilityTag,
	toggleCapability,
} from './toolCapabilities.js';

test('capability catalog exposes editable media tags and reserves the rest', () => {
	const editable = EDITABLE_CAPABILITY_TAGS as readonly ModelCapabilityTag[];
	assert.ok(editable.includes('image_generation'));
	for (const tag of CAPABILITY_TAGS) {
		assert.equal(tag.reserved, !EDITABLE_CAPABILITY_TAGS.includes(tag.key));
	}
	for (const reserved of ['video_generation', 'tts', 'asr', 'ocr', 'video_caption']) {
		assert.ok(CAPABILITY_TAGS.some((tag) => tag.key === reserved && tag.reserved));
	}
});

test('toggleCapability adds and removes tags without duplicates', () => {
	assert.deepEqual(toggleCapability(undefined, 'image_generation', true), ['image_generation']);
	assert.deepEqual(toggleCapability(['ocr'], 'image_generation', true), ['ocr', 'image_generation']);
	assert.deepEqual(toggleCapability(['image_generation', 'ocr'], 'image_generation', false), ['ocr']);
});

test('hasCapability treats missing capability lists as empty', () => {
	assert.equal(hasCapability({capabilities: ['image_generation']}, 'image_generation'), true);
	assert.equal(hasCapability({capabilities: []}, 'image_generation'), false);
	assert.equal(hasCapability({}, 'image_generation'), false);
});
