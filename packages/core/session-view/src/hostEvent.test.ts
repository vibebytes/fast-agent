import test from 'node:test';
import assert from 'node:assert/strict';
import {
	followUpQueueFrom,
	parseEngineKind,
	parseMentionsJson,
	paintsCommandError,
	sessionTitleDecision,
	skillErrorNeedsEngineSlashHint
} from './hostEvent.js';

test('followUpQueueFrom sorts by id, parses mentions, drops malformed rows', () => {
	const q = followUpQueueFrom(
		JSON.stringify([
			{id: 'b', text: 'second', mentionsJson: '[{"kind":"skill","locator":"plan"}]'},
			{id: 'a', text: 'first'},
			{id: '', text: 'no id'},
			'nope'
		])
	);
	assert.deepEqual(q.map(x => x.id), ['a', 'b']);
	assert.deepEqual(q[1].mentions, [{kind: 'skill', locator: 'plan'}]);
});

test('followUpQueueFrom tolerates garbage json', () => {
	assert.deepEqual(followUpQueueFrom('{oops'), []);
	assert.deepEqual(followUpQueueFrom('42'), []);
});

test('parseMentionsJson keeps chip fields and drops bad rows', () => {
	const chips = parseMentionsJson(
		'[{"kind":"file","locator":"a.ts","displayName":"A","ref":"@/a.ts"},{"kind":"","locator":"x"}]'
	);
	assert.equal(chips.length, 1);
	assert.deepEqual(chips[0], {kind: 'file', locator: 'a.ts', displayName: 'A', ref: '@/a.ts'});
	assert.deepEqual(parseMentionsJson('not json'), []);
});

test('parseEngineKind defaults to fast, only exact dsh maps to dsh', () => {
	assert.equal(parseEngineKind(undefined), 'fast');
	assert.equal(parseEngineKind(null), 'fast');
	assert.equal(parseEngineKind('fast'), 'fast');
	assert.equal(parseEngineKind(' DSH '), 'dsh');
	assert.equal(parseEngineKind('dshx'), 'fast');
});

test('sessionTitleDecision reverts with previous title on error', () => {
	const d = sessionTitleDecision({status: 'error', message: 'boom'}, {previous: 'Old'});
	assert.deepEqual(d, {kind: 'revert', previous: 'Old', notice: 'boom'});
	assert.equal(sessionTitleDecision({status: 'error'}, null), null);
});

test('sessionTitleDecision resolves ok with trimmed title', () => {
	const d = sessionTitleDecision({status: 'ok', title: '  T  '}, {previous: 'Old'});
	assert.deepEqual(d, {kind: 'ok', resolvedTitle: 'T', hadPending: true});
});

test('paintsCommandError paints skill_view errors, skips builtin results', () => {
	assert.equal(paintsCommandError('skill_view', 'error', 'nope'), true);
	assert.equal(paintsCommandError(undefined, 'error', 'Unknown command: /zz'), true);
	assert.equal(paintsCommandError('skills', 'error', 'whatever'), false);
	assert.equal(paintsCommandError('debug', 'error', 'x'), false);
	assert.equal(paintsCommandError('model', 'error', ''), false);
	assert.equal(paintsCommandError('skill_view', 'ok', 'nope'), false);
});

test('skillErrorNeedsEngineSlashHint only for known host skill + bare Unknown command', () => {
	assert.equal(skillErrorNeedsEngineSlashHint('review', 'Unknown command: /review', true), true);
	assert.equal(skillErrorNeedsEngineSlashHint('review', 'Unknown command: /review (legacy)', true), false);
	assert.equal(skillErrorNeedsEngineSlashHint('review', 'Unknown command: /review', false), false);
	assert.equal(skillErrorNeedsEngineSlashHint('skills', 'Unknown command: /skills', true), false);
	assert.equal(skillErrorNeedsEngineSlashHint(undefined, 'Unknown command: /x', true), false);
});
