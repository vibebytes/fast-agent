/** protocol.test — sessionRestore. Loaded by protocol.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeEventSchema, bridgeCommandSchema, isLiveChrome, parseBridgeCommand, pickIdList, wireIdList} from '../protocol.js';

test('bridgeEventSchema accepts session_restored and sessions_list', () => {
	const restored = bridgeEventSchema.parse({
		type: 'session_restored',
		sessionId: 'abc-123',
		turns: [{
			turnId: 'restored_0',
			userText: 'hello',
			assistantText: 'hi',
			thinking: 'plan',
			tools: [{id: 't1', tool: 'shell', args: {command: 'ls'}, status: 'success'}],
			tokensUsed: 42
		}],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	assert.equal(restored.type, 'session_restored');
	assert.equal(restored.turns[0]?.userText, 'hello');
	if (restored.type === 'session_restored') {
		assert.equal(restored.hasMoreOlder, false);
		assert.equal(restored.totalTurnCount, 1);
	}

	const withSteps = bridgeEventSchema.parse({
		type: 'session_restored',
		sessionId: 'abc-123',
		turns: [{
			turnId: 'restored_0',
			userText: 'research',
			assistantText: 'done',
			thinking: 'first then second',
			tools: [
				{id: 't1', tool: 'read_file', args: {path: 'a.ts'}, status: 'success'},
				{id: 't2', tool: 'shell', args: {command: 'ls'}, status: 'success'}
			],
			steps: [
				{reasoning: 'first', tools: [{id: 't1', tool: 'read_file', args: {path: 'a.ts'}, status: 'success'}], text: 'looking'},
				{reasoning: 'second', tools: [{id: 't2', tool: 'shell', args: {command: 'ls'}, status: 'success'}], text: 'done'}
			]
		}]
	});
	assert.equal(withSteps.type, 'session_restored');
	assert.equal(withSteps.turns[0]?.steps?.length, 2);
	assert.equal(withSteps.turns[0]?.steps?.[0]?.reasoning, 'first');
	assert.equal(withSteps.turns[0]?.steps?.[1]?.text, 'done');

	const failedTurn = bridgeEventSchema.parse({
		type: 'session_restored',
		sessionId: 'abc-123',
		turns: [{
			turnId: 'restored_fail',
			userText: 'hi',
			assistantText: 'boom',
			failed: true
		}]
	});
	assert.equal(failedTurn.type, 'session_restored');
	if (failedTurn.type === 'session_restored') {
		assert.equal(failedTurn.turns[0]?.failed, true);
	}

	const listed = bridgeEventSchema.parse({
		type: 'sessions_list',
		sessions: [{
			id: 'abc-123',
			title: 'Fix bug',
			summary: 'Worked on auth',
			lastModified: '2026-06-09T08:00:00Z',
			messageCount: 4,
			cwd: '/tmp/project',
			isCurrent: true
		}]
	});
	assert.equal(listed.type, 'sessions_list');
	assert.equal(listed.sessions[0]?.isCurrent, true);
});

test('session_restored steps accept optional plan snapshot', () => {
	const restored = bridgeEventSchema.parse({
		type: 'session_restored',
		sessionId: 's1',
		turns: [{
			turnId: 't0',
			userText: 'plan it',
			assistantText: '',
			steps: [{
				tools: [{id: 'u1', tool: 'upsert_plan', status: 'success', summary: '{"ok":true,"plan_id":"p1"}'}],
				plan: {
					planId: 'p1',
					name: 'Auth',
					overview: 'Login flow',
					todos: [{id: 'a', content: 'routes', status: 'pending'}],
					body: 'Details'
				}
			}]
		}]
	});
	assert.equal(restored.type, 'session_restored');
	if (restored.type === 'session_restored') {
		assert.equal(restored.turns[0]?.steps?.[0]?.plan?.planId, 'p1');
	}
});

test('bridgeEventSchema accepts session_history_page for older Turn prepend', () => {
	const page = bridgeEventSchema.parse({
		type: 'session_history_page',
		sessionId: 'abc-123',
		beforeTurnId: 'restored_20',
		hasMoreOlder: true,
		totalTurnCount: 40,
		turns: [{
			turnId: 'restored_0',
			userText: 'older',
			assistantText: 'reply',
			tools: []
		}]
	});
	assert.equal(page.type, 'session_history_page');
	if (page.type === 'session_history_page') {
		assert.equal(page.beforeTurnId, 'restored_20');
		assert.equal(page.hasMoreOlder, true);
		assert.equal(page.totalTurnCount, 40);
		assert.equal(page.turns[0]?.turnId, 'restored_0');
	}
});
