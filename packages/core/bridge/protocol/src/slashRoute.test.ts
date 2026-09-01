import test from 'node:test';
import assert from 'node:assert/strict';
import {
	formatUserSkillDisplayLine,
	isSkillSlashName,
	parseSkillInjectedMessage,
	parseUserSkillDisplay,
	resolveSlashRoute
} from './slashRoute.js';

test('parseSkillInjectedMessage extracts name and task from legacy inject', () => {
	const raw =
		'[Skill: improve-codebase-architecture]\n# Improve Codebase Architecture\n\nbody\n\n---\n\nreview this';
	assert.deepEqual(parseSkillInjectedMessage(raw), {
		name: 'improve-codebase-architecture',
		args: 'review this'
	});
	assert.deepEqual(parseSkillInjectedMessage('[Skill: research]\nonly body'), {
		name: 'research',
		args: ''
	});
	assert.equal(parseSkillInjectedMessage('/research hi'), null);
});

test('parseUserSkillDisplay accepts slash-only or legacy inject', () => {
	assert.deepEqual(parseUserSkillDisplay('/research Add instructions'), {
		name: 'research',
		args: 'Add instructions'
	});
	assert.deepEqual(
		parseUserSkillDisplay('[Skill: research]\n# Research\n\n---\n\nfocus on memory'),
		{name: 'research', args: 'focus on memory'}
	);
});

test('parseUserSkillDisplay recovers leaked goal/loop postSubmitPrompt (pre-fix persist)', () => {
	const leaked =
		'我有1万块，希望定制方案\n\n' +
		'Call the goal tool with action=plan now, with the FULL draft (statement, acceptance, members_json). ' +
		'Do not research, shell, or write the deliverable in this turn.';
	assert.deepEqual(parseUserSkillDisplay(leaked), {
		name: 'goal',
		args: '我有1万块，希望定制方案'
	});
	assert.equal(formatUserSkillDisplayLine(leaked), '/goal 我有1万块，希望定制方案');
	const leakedV2 =
		'实现一个小蝌蚪找妈妈\n\n' +
		'Call the goal tool now. Arguments MUST include action=plan (never omit), plus statement, acceptance, and members_json. ' +
		'Example: {"action":"plan","statement":"…","acceptance":"…","members_json":"[…]"}. ' +
		'Do not research, shell, or write the deliverable in this turn.';
	assert.deepEqual(parseUserSkillDisplay(leakedV2), {
		name: 'goal',
		args: '实现一个小蝌蚪找妈妈'
	});
	const loopLeaked =
		'every hour check\n\nCall the schedule tool with action=create (kind=session_loop) now. Do not execute the recurring task yourself.';
	assert.deepEqual(parseUserSkillDisplay(loopLeaked), {name: 'loop', args: 'every hour check'});
});

test('formatUserSkillDisplayLine hides legacy skill body', () => {
	assert.equal(formatUserSkillDisplayLine('/research focus'), '/research focus');
	assert.equal(formatUserSkillDisplayLine('/research'), '/research');
	assert.equal(
		formatUserSkillDisplayLine('[Skill: research]\n# Research\n\nbody\n\n---\n\nfocus on memory'),
		'/research focus on memory'
	);
	assert.equal(formatUserSkillDisplayLine('plain hello'), null);
});

test('resolveSlashRoute allowlists fixed/skills; unknown is message', () => {
	assert.deepEqual(resolveSlashRoute('/mode agent', []), {kind: 'slash', name: 'mode', args: 'agent'});
	assert.deepEqual(resolveSlashRoute('/help', []), {kind: 'slash', name: 'help', args: ''});
	assert.deepEqual(resolveSlashRoute('/plan', ['plan']), {kind: 'slash', name: 'plan', args: ''});
	assert.deepEqual(resolveSlashRoute('/agent build a verifier', ['agent']), {
		kind: 'slash',
		name: 'agent',
		args: 'build a verifier'
	});
	assert.deepEqual(resolveSlashRoute('/explain-code look', ['explain-code']), {
		kind: 'slash',
		name: 'explain-code',
		args: 'look'
	});
	assert.deepEqual(resolveSlashRoute('/not-a-skill hi', ['explain-code']), {
		kind: 'message',
		text: '/not-a-skill hi'
	});
	// Builtin skills need catalog membership; bare /plan without skill list is ordinary text.
	assert.deepEqual(resolveSlashRoute('/plan', []), {kind: 'message', text: '/plan'});
});

test('isSkillSlashName: mode is fixed; plan/agent are SkillSlash candidates', () => {
	assert.equal(isSkillSlashName('mode'), false);
	assert.equal(isSkillSlashName('plan'), true);
	assert.equal(isSkillSlashName('agent'), true);
	assert.equal(isSkillSlashName('explain-code'), true);
	assert.deepEqual(resolveSlashRoute('/plan now', ['plan']), {
		kind: 'slash',
		name: 'plan',
		args: 'now'
	});
});
