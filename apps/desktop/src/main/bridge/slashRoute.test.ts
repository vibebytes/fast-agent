import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {isSkillSlashName, resolveSlashRoute} from '@fastllm/bridge-protocol';

describe('slashRoute (bridge-protocol)', () => {
	it('routes Bridge fixed and known skills as slash', () => {
		assert.deepEqual(resolveSlashRoute('/model', []), {kind: 'slash', name: 'model', args: ''});
		assert.deepEqual(resolveSlashRoute('/help', []), {kind: 'slash', name: 'help', args: ''});
		assert.deepEqual(resolveSlashRoute('/explain-code look', ['explain-code']), {
			kind: 'slash',
			name: 'explain-code',
			args: 'look'
		});
	});

	it('unknown /xxx is an ordinary message', () => {
		assert.deepEqual(resolveSlashRoute('/not-a-skill hi', ['explain-code']), {
			kind: 'message',
			text: '/not-a-skill hi'
		});
	});

	it('fixed command wins over skill name collision', () => {
		assert.deepEqual(resolveSlashRoute('/model now', ['model']), {
			kind: 'slash',
			name: 'model',
			args: 'now'
		});
		assert.equal(isSkillSlashName('model'), false);
		assert.equal(isSkillSlashName('explain-code'), true);
	});

	it('plan is the builtin plan SkillSlash — not a fixed command (sticky RunMode sync)', () => {
		assert.equal(isSkillSlashName('plan'), true);
		assert.deepEqual(resolveSlashRoute('/plan now', ['plan']), {
			kind: 'slash',
			name: 'plan',
			args: 'now'
		});
		// Without the skill in the catalog, /plan stays an ordinary message.
		assert.deepEqual(resolveSlashRoute('/plan', []), {kind: 'message', text: '/plan'});
	});
});
