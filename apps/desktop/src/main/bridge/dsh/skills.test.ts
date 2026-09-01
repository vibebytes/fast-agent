import assert from 'node:assert/strict';
import {test} from 'node:test';
import {asSlashCatalog, listDshSkills, promptLine} from './skills.js';

test('asSlashCatalog maps skill.list rows and marks user-only skills', () => {
	assert.deepEqual(
		asSlashCatalog({
			skills: [
				{name: 'review', description: 'Review the diff', modelInvocable: true},
				{name: 'secret', description: 'Local only', modelInvocable: false},
				{name: '  '},
				{description: 'no name'}
			]
		}),
		[
			{name: 'review', description: 'Review the diff', available: true, badge: undefined},
			{name: 'secret', description: 'Local only', available: true, badge: 'user'}
		]
	);
});

test('asSlashCatalog returns empty when skills is missing or not a list', () => {
	assert.deepEqual(asSlashCatalog(null), []);
	assert.deepEqual(asSlashCatalog({}), []);
	assert.deepEqual(asSlashCatalog({skills: {name: 'x'}}), []);
});

test('listDshSkills calls skill.list and returns the parsed catalog', async () => {
	const hops: Array<{method: string; payload?: Record<string, unknown>; sessionId?: string}> = [];
	const result = await listDshSkills(async (method, payload, sessionId) => {
		hops.push({method, payload, sessionId});
		return {ok: true, method, value: {skills: [{name: 'review', description: 'd'}]}};
	}, 's1');
	assert.deepEqual(hops, [{method: 'skill.list', payload: {sessionId: 's1'}, sessionId: 's1'}]);
	assert.deepEqual(result, {
		ok: true,
		value: [{name: 'review', description: 'd', available: true, badge: undefined}]
	});
});

test('listDshSkills passes engine errors through', async () => {
	const result = await listDshSkills(async () => ({ok: false, error: {code: 'unavailable'}}), 's1');
	assert.deepEqual(result, {ok: false, error: {code: 'unavailable'}});
});

test('promptLine is plain /name text and does not fill Fast skillSlash', () => {
	assert.equal(promptLine('/review', 'the diff'), '/review the diff');
	assert.equal(promptLine('review'), '/review');
});
