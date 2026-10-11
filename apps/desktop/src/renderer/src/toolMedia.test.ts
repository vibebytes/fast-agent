import assert from 'node:assert/strict';
import test from 'node:test';
import {extractMediaArtifact} from './toolMedia.ts';

test('video, audio, and image saves become players', () => {
	assert.deepEqual(
		extractMediaArtifact('Video saved to videos/neon_alley_fight.mp4 (gen-vid-179173263)'),
		{kind: 'video', path: 'videos/neon_alley_fight.mp4'}
	);
	assert.deepEqual(extractMediaArtifact('Audio saved to audio/hello.mp3'), {
		kind: 'audio',
		path: 'audio/hello.mp3'
	});
	assert.deepEqual(extractMediaArtifact('Image saved to images/01a12b18-38a.png'), {
		kind: 'image',
		path: 'images/01a12b18-38a.png'
	});
});

test('prose without a media path stays text', () => {
	assert.equal(extractMediaArtifact('generate_video finished'), null);
	assert.equal(extractMediaArtifact('model gpt-image-2'), null);
});
