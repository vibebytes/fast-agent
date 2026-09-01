import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
	applyAtPick,
	atQuery,
	atQuerySpan,
	atSuggestPrefix,
	chipFromAtItem,
	clearAtToken,
	composeMentionSubmit,
	draftHasMentionTags,
	formatAtPayload,
	groupsToAtItems,
	mentionDraftSegments,
	mergeChip,
	type AtItem
} from './atCatalog';

const skill: AtItem = {
	ref: '@skill/explain-code',
	label: 'Explain Code',
	description: 'd',
	kind: 'skill',
	locator: 'explain-code'
};

describe('atCatalog mid-sentence @ menu', () => {
	it('atQuery matches draft starting with @', () => {
		assert.equal(atQuery('@'), '');
		assert.equal(atQuery('@ex'), 'ex');
		assert.equal(atQuery('@ex now'), null);
	});

	it('atQuery matches @ after whitespace mid-sentence', () => {
		assert.equal(atQuery('please @'), '');
		assert.equal(atQuery('please @sk'), 'sk');
		assert.equal(atQuery('please @sk more'), null);
		assert.equal(atQuery('no mention here'), null);
	});

	it('atQuerySpan respects caret inside draft', () => {
		const draft = 'hi @ex bye';
		assert.deepEqual(atQuerySpan(draft, 'hi @ex'.length), {
			query: 'ex',
			start: 3,
			end: 6
		});
		assert.equal(atQuerySpan(draft, draft.length), null);
	});

	it('atSuggestPrefix includes leading @', () => {
		assert.equal(atSuggestPrefix('@sk'), '@sk');
		assert.equal(atSuggestPrefix('please @team/'), 'please @team/'.slice('please '.length));
		assert.equal(atSuggestPrefix('please @team/'), '@team/');
	});

	it('applyAtPick inserts canonical @kind/locator (slash, not colon)', () => {
		assert.equal(formatAtPayload(skill), '@skill/explain-code');
		assert.ok(!formatAtPayload(skill).includes(':'));
		assert.equal(applyAtPick('@ex', skill), '@skill/explain-code ');
		assert.equal(applyAtPick('please @sk', skill), 'please @skill/explain-code ');
		assert.equal(
			applyAtPick('a @sk b', skill, 'a @sk'.length),
			'a @skill/explain-code  b'
		);
	});

	it('chipFromAtItem and mergeChip', () => {
		const chip = chipFromAtItem(skill);
		assert.deepEqual(chip, {
			kind: 'skill',
			locator: 'explain-code',
			displayName: 'Explain Code',
			ref: '@skill/explain-code'
		});
		const merged = mergeChip([chip], {
			...chip,
			displayName: 'Explain'
		});
		assert.equal(merged.length, 1);
		assert.equal(merged[0]!.displayName, 'Explain');
	});

	it('groupsToAtItems flattens Bridge groups', () => {
		const items = groupsToAtItems([
			{
				kind: 'skill',
				tier: 'A',
				items: [
					{
						ref: '@skill/plan',
						displayName: 'Plan',
						payload: {kind: 'skill', locator: 'plan'}
					}
				]
			}
		]);
		assert.equal(items.length, 1);
		assert.equal(items[0]!.ref, '@skill/plan');
		assert.equal(items[0]!.kind, 'skill');
	});

	it('mentionDraftSegments tags canonical refs without changing text', () => {
		const segs = mentionDraftSegments('use @skill/mcp-builder please');
		assert.deepEqual(
			segs.map(s => s.text).join(''),
			'use @skill/mcp-builder please'
		);
		assert.equal(segs.filter(s => s.type === 'mention').length, 1);
		assert.equal(segs.find(s => s.type === 'mention')?.ref, '@skill/mcp-builder');
		assert.equal(draftHasMentionTags('@skill/x'), true);
		assert.equal(draftHasMentionTags('hello @sk'), false);
	});

	it('clearAtToken + composeMentionSubmit match slash-chip submit shape', () => {
		assert.equal(clearAtToken('please @sk'), 'please ');
		assert.equal(clearAtToken('@sk'), '');
		assert.equal(
			composeMentionSubmit('look at this', [
				{kind: 'file', locator: 'a.html', ref: '@file/a.html', displayName: 'a.html'}
			]),
			'@file/a.html look at this'
		);
		assert.equal(
			composeMentionSubmit('', [
				{kind: 'skill', locator: 'plan', ref: '@skill/plan', displayName: 'Plan'}
			]),
			'@skill/plan'
		);
	});
});
