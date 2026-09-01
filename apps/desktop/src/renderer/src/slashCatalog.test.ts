import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
	CODING_SKILL_NAMES,
	exactSlashMatch,
	filterSlashMenu,
	flattenSlashMenu,
	formatSlashSubmit,
	HOST_SLASH_COMMANDS,
	parseSlashInput,
	parseUserSkillDisplay,
	PLATFORM_SKILL_NAMES,
	resolveSlashRoute,
	skillsFromCatalog,
	slashQuery,
	slashTitle
} from './slashCatalog.js';
import {parseSkillInjectedMessage} from '@fastllm/bridge-protocol';

describe('slashCatalog', () => {
	it('slashQuery only matches in-progress /partial without args', () => {
		assert.equal(slashQuery('/'), '');
		assert.equal(slashQuery('/pla'), 'pla');
		assert.equal(slashQuery('/plan now'), null);
		assert.equal(slashQuery('hello'), null);
	});

	it('host commands include mode; never exit-plan or plan', () => {
		assert.deepEqual(
			HOST_SLASH_COMMANDS.map(c => c.name),
			['help', 'clear', 'model', 'mode']
		);
		assert.ok(!HOST_SLASH_COMMANDS.some(c => c.name === 'exit-plan'));
		assert.ok(!HOST_SLASH_COMMANDS.some(c => c.name === 'plan'));
	});

	it('filterSlashMenu splits platform / coding / external; commands first in flatten', () => {
		const skills = skillsFromCatalog([
			{name: 'improve-codebase-architecture', description: 'Arch', available: true, badge: 'personal'},
			{name: 'brainstorm', description: 'Ideas', available: true, badge: 'builtin'},
			{name: 'plan', description: 'Plan', available: true, badge: 'builtin'},
			{name: 'to-tickets', description: 'Tickets', available: true, badge: 'builtin'},
			{name: 'diagnosing-bugs', description: 'Bugs', available: true, badge: 'personal'}
		]);
		const groups = filterSlashMenu('', skills);
		assert.deepEqual(
			groups.platform.map(s => s.name),
			['plan']
		);
		assert.deepEqual(
			groups.coding.map(s => s.name),
			['brainstorm', 'to-tickets']
		);
		assert.deepEqual(
			groups.external.map(s => s.name),
			['diagnosing-bugs', 'improve-codebase-architecture']
		);
		const flat = flattenSlashMenu(groups);
		assert.equal(flat[0]?.kind, 'command');
		assert.equal(flat[0]?.name, 'help');
		const skillNames = flat.filter(i => i.kind === 'skill').map(i => i.name);
		assert.deepEqual(skillNames, [
			'plan',
			'brainstorm',
			'to-tickets',
			'diagnosing-bugs',
			'improve-codebase-architecture'
		]);
	});

	it('filterSlashMenu query filters all groups', () => {
		const skills = skillsFromCatalog([
			{name: 'plan', description: 'Plan work', available: true},
			{name: 'explore', description: 'Explore code', available: true},
			{name: 'ops-only', description: 'Ops', available: true}
		]);
		const groups = filterSlashMenu('ex', skills);
		assert.ok(groups.coding.some(s => s.name === 'explore'));
		assert.ok(!groups.platform.some(s => s.name === 'plan'));
		assert.ok(!groups.external.some(s => s.name === 'ops-only'));
		assert.ok(!groups.commands.some(c => c.name === 'exit-plan'));
	});

	it('filterSlashMenu does not match short query against description', () => {
		const skills = skillsFromCatalog([
			{name: 'plan', description: 'Explore the codebase and deliver a plan', available: true},
			{name: 'explore', description: 'Explore code', available: true}
		]);
		const short = filterSlashMenu('ex', skills);
		assert.ok(short.coding.some(s => s.name === 'explore'));
		assert.ok(!short.platform.some(s => s.name === 'plan'), '1–2 char must not hit description');
		const mid = filterSlashMenu('exp', skills);
		assert.ok(mid.coding.some(s => s.name === 'explore'), 'name prefix still works');
		assert.ok(
			!mid.platform.some(s => s.name === 'plan'),
			'/exp must not hit plan via "Explore…"'
		);
		const long = filterSlashMenu('explor', skills);
		assert.ok(long.platform.some(s => s.name === 'plan'), '≥5 char token-prefix may match description');
	});

	it('filterSlashMenu does not match commands via description (mode contains plan/ask)', () => {
		const skills = skillsFromCatalog([{name: 'plan', description: 'Plan work', available: true}]);
		const groups = filterSlashMenu('pla', skills);
		assert.ok(groups.platform.some(s => s.name === 'plan'));
		assert.ok(
			!groups.commands.some(c => c.name === 'mode'),
			'/pla must not hit mode via "…plan|ask…"'
		);
		assert.ok(filterSlashMenu('mo', skills).commands.some(c => c.name === 'mode'));
	});

	it('filterSlashMenu sorts external by name', () => {
		const skills = skillsFromCatalog([
			{name: 'zeta-tool', description: 'Z', available: true},
			{name: 'alpha-tool', description: 'A', available: true}
		]);
		const groups = filterSlashMenu('', skills);
		assert.deepEqual(
			groups.external.map(s => s.name),
			['alpha-tool', 'zeta-tool']
		);
	});

	it('platform and coding name tables match product catalog', () => {
		assert.ok(PLATFORM_SKILL_NAMES.includes('distill'));
		assert.ok(PLATFORM_SKILL_NAMES.includes('research'));
		assert.ok(CODING_SKILL_NAMES.includes('brainstorm'));
		assert.ok(CODING_SKILL_NAMES.includes('to-tickets'));
		assert.ok(CODING_SKILL_NAMES.includes('review'));
		assert.ok(!(CODING_SKILL_NAMES as readonly string[]).includes('diagnosing-bugs'));
		assert.ok(!(CODING_SKILL_NAMES as readonly string[]).includes('code-review'));
	});

	it('near-name disk skills land in external, not Coding', () => {
		const skills = skillsFromCatalog([
			{name: 'code-review', description: 'Standards/Spec', available: true},
			{name: 'review', description: 'Product review', available: true},
			{name: 'diagnosing-bugs', description: 'Bugs', available: true}
		]);
		const groups = filterSlashMenu('', skills);
		assert.deepEqual(
			groups.coding.map(s => s.name),
			['review']
		);
		assert.deepEqual(
			groups.external.map(s => s.name).sort(),
			['code-review', 'diagnosing-bugs']
		);
	});

	it('skillsFromCatalog drops host names and unavailable; keeps Catalog badge', () => {
		const skills = skillsFromCatalog([
			{name: 'help', description: 'should drop', available: true},
			{name: 'plan', description: 'Plan', available: true, badge: 'project'},
			{name: 'hidden', description: 'nope', available: false}
		]);
		assert.deepEqual(
			skills.map(s => s.name),
			['plan']
		);
		assert.equal(skills[0]?.badge, 'project');
	});

	it('skillsFromCatalog omits badge when Catalog did not send one', () => {
		const skills = skillsFromCatalog([{name: 'plan', description: 'Plan', available: true}]);
		assert.equal(skills[0]?.badge, undefined);
	});

	it('exactSlashMatch is case-insensitive', () => {
		const items = skillsFromCatalog([{name: 'explain-code', description: 'Explain', available: true}]);
		assert.equal(exactSlashMatch('Explain-Code', items)?.name, 'explain-code');
		assert.equal(exactSlashMatch('ex', items), undefined);
	});

	it('formatSlashSubmit joins args', () => {
		assert.equal(formatSlashSubmit('brainstorm', ''), '/brainstorm');
		assert.equal(formatSlashSubmit('brainstorm', '  auth  '), '/brainstorm auth');
	});

	it('parseSlashInput splits name and args', () => {
		assert.deepEqual(parseSlashInput('/improve-codebase-architecture'), {
			name: 'improve-codebase-architecture',
			args: ''
		});
		assert.deepEqual(parseSlashInput('/improve-codebase-architecture 测试'), {
			name: 'improve-codebase-architecture',
			args: '测试'
		});
		assert.equal(parseSlashInput('hello'), null);
	});

	it('parseSkillInjectedMessage / parseUserSkillDisplay for slash-only and legacy inject', () => {
		const injected =
			'[Skill: improve-codebase-architecture]\n# Title\n\n---\n\nreview this';
		assert.deepEqual(parseSkillInjectedMessage(injected), {
			name: 'improve-codebase-architecture',
			args: 'review this'
		});
		assert.deepEqual(parseUserSkillDisplay(injected)?.name, 'improve-codebase-architecture');
		assert.deepEqual(parseUserSkillDisplay('/research hi'), {name: 'research', args: 'hi'});
	});

	it('slashTitle title-cases kebab names', () => {
		assert.equal(slashTitle('improve-codebase-architecture'), 'Improve Codebase Architecture');
		assert.equal(slashTitle('help'), 'Help');
	});

	it('resolveSlashRoute allowlists fixed/skills; unknown is message', () => {
		assert.equal(resolveSlashRoute('/skills', []).kind, 'slash');
		assert.equal(resolveSlashRoute('/brainstorm', ['brainstorm']).kind, 'slash');
		assert.deepEqual(resolveSlashRoute('/nope', []), {kind: 'message', text: '/nope'});
	});
});
