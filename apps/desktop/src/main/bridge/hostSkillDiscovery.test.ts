import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {discoverHostSlashSkills, normalizeSlashBadge} from './hostSkillDiscovery.js';

describe('normalizeSlashBadge', () => {
	it('maps legacy zh/en labels to stable ids and passes unknown through', () => {
		assert.equal(normalizeSlashBadge('个人'), 'personal');
		assert.equal(normalizeSlashBadge('Personal'), 'personal');
		assert.equal(normalizeSlashBadge('内置'), 'builtin');
		assert.equal(normalizeSlashBadge('Built-in'), 'builtin');
		assert.equal(normalizeSlashBadge('项目'), 'project');
		assert.equal(normalizeSlashBadge('project'), 'project');
		assert.equal(normalizeSlashBadge('custom'), 'custom');
	});
});

describe('discoverHostSlashSkills', () => {
	it('returns no project skills for a missing remote path', () => {
		const found = discoverHostSlashSkills('/no/such/remote/workspace');
		assert.equal(
			found.some(s => s.badge === 'project'),
			false
		);
	});

	it('reads project SKILL.md and prefers project over user when names collide', () => {
		const root = mkdtempSync(join(tmpdir(), 'host-skills-'));
		const projectSkills = join(root, '.agents', 'skills', 'demo');
		mkdirSync(projectSkills, {recursive: true});
		writeFileSync(
			join(projectSkills, 'SKILL.md'),
			`---\nname: demo\ndescription: From project\n---\n\nbody\n`
		);

		const found = discoverHostSlashSkills(root);
		const demo = found.find(s => s.name === 'demo');
		assert.ok(demo);
		assert.equal(demo?.description, 'From project');
		assert.equal(demo?.badge, 'project');
	});
});
