import test from 'node:test';
import assert from 'node:assert/strict';
import {
	applyMentionPick,
	buildSuggestions,
	mentionTokenSpan,
	moveSuggestion,
	initialSuggestionState
} from './SuggestionEngine.js';
import {createBuiltinCommands} from '../commands/registry.js';

test('buildSuggestions returns slash commands', () => {
	const groups = buildSuggestions({
		partial: '/mod',
		commands: createBuiltinCommands(),
		history: [],
		cwd: '/tmp',
		model: 'default'
	});
	assert.ok(groups.length > 0);
	assert.ok(groups[0]?.items.some(item => item.label.includes('model')));
});

test('buildSuggestions @ uses Mentions groups not fake paths', () => {
	const groups = buildSuggestions({
		partial: '@skill/pl',
		commands: createBuiltinCommands(),
		history: [],
		cwd: '/tmp',
		model: 'default',
		mentionGroups: [
			{
				kind: 'skill',
				tier: 'A',
				items: [
					{
						ref: '@skill/plan',
						displayName: 'Plan',
						description: 'Plan work',
						payload: {kind: 'skill', locator: 'plan'}
					}
				]
			}
		]
	});
	assert.equal(groups.length, 1);
	assert.equal(groups[0]?.items[0]?.value, '@skill/plan');
	assert.equal(groups[0]?.items[0]?.label, 'Plan');
	assert.ok(!groups.some(g => g.title === 'Files'));
});

test('buildSuggestions @ without groups is empty (no fake path main path)', () => {
	const groups = buildSuggestions({
		partial: '@src',
		commands: createBuiltinCommands(),
		history: [],
		cwd: '/tmp',
		model: 'default'
	});
	assert.equal(groups.length, 0);
});

test('mentionTokenSpan detects mid-sentence @ prefix', () => {
	assert.deepEqual(mentionTokenSpan('@sk'), {prefix: '@sk', start: 0, end: 3});
	assert.deepEqual(mentionTokenSpan('hello @team/'), {
		prefix: '@team/',
		start: 6,
		end: 12
	});
	assert.equal(mentionTokenSpan('hello @team/ x'), null);
	assert.equal(applyMentionPick('hello @sk', '@skill/plan'), 'hello @skill/plan');
	assert.equal(applyMentionPick('@sk', '@skill/plan'), '@skill/plan');
});

test('buildSuggestions mid-sentence prefix uses Mentions groups', () => {
	const groups = buildSuggestions({
		partial: '@team/',
		commands: createBuiltinCommands(),
		history: [],
		cwd: '/tmp',
		model: 'default',
		mentionGroups: [
			{
				kind: 'team',
				tier: 'C',
				items: [
					{
						ref: '@team/reviewers',
						displayName: 'reviewers',
						payload: {kind: 'team', locator: 'reviewers', entity: 'team'}
					}
				]
			}
		]
	});
	assert.equal(groups[0]?.items[0]?.value, '@team/reviewers');
});

test('moveSuggestion wraps active index', () => {
	const state = {
		...initialSuggestionState,
		groups: [{title: 'Commands', items: [
			{value: '/a', label: '/a'},
			{value: '/b', label: '/b'}
		]}],
		activeIndex: 0,
		visible: true
	};
	const next = moveSuggestion(state, 'down');
	assert.equal(next.activeIndex, 1);
});
