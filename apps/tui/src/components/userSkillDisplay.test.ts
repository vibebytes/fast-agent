import test from 'node:test';
import assert from 'node:assert/strict';
import {formatUserSkillDisplayLine, parseUserSkillDisplay} from '@fastllm/bridge-protocol';

test('cli-ink skill display matches slash-only and hides legacy body', () => {
	assert.deepEqual(parseUserSkillDisplay('/explain-code review helpers'), {
		name: 'explain-code',
		args: 'review helpers'
	});
	assert.deepEqual(
		parseUserSkillDisplay('[Skill: explain-code]\n# Body\n\ninstructions\n\n---\n\nreview helpers'),
		{name: 'explain-code', args: 'review helpers'}
	);
	const preview = formatUserSkillDisplayLine(
		'[Skill: research]\n# Research\n\nbody\n\n---\n\nfocus memory'
	);
	assert.equal(preview, '/research focus memory');
	assert.ok(preview && !preview.includes('body'));
	assert.ok(preview && !preview.includes('[Skill:'));
});
