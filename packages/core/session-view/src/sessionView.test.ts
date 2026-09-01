import test from 'node:test';
import assert from 'node:assert/strict';
import {
	applyBridgeEvent,
	createTranscriptState,
	createSessionViewProjector,
	projectSessionView,
	reviewFiles
} from './index.js';

test('projectSessionView merges fileDiffs and sets showStop on in-flight user', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		sessionId: 's1',
		turnId: 'client_1',
		clientMessageId: 'client_1',
		text: 'edit me'
	} as never);
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		sessionId: 's1',
		clientMessageId: 'client_1',
		turnId: 'run-1'
	} as never);
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		sessionId: 's1',
		turnId: 'run-1',
		text: 'working'
	} as never);

	const project = createSessionViewProjector();
	const items = project(
		state,
		[],
		{canCancel: true}
	);
	const user = items.find(i => i.kind === 'user');
	assert.ok(user && user.kind === 'user');
	assert.equal(user.showStop, true);

	const idle = projectSessionView(state, [], {canCancel: false});
	const userIdle = idle.find(i => i.kind === 'user');
	assert.ok(userIdle && userIdle.kind === 'user');
	assert.equal(userIdle.showStop, undefined);
});

test('reviewFiles prefers timeline file stats then fills from codeChanges', () => {
	const items = projectSessionView(
		{
			entries: [],
			approvals: [],
			questions: []
		},
		[
			{
				id: 'c1',
				path: 'a.ts',
				status: 'done',
				diff: '@@ -1 +1 @@\n-a\n+b\n'
			}
		],
		{canCancel: false}
	);
	const files = reviewFiles(items, [
		{
			id: 'c1',
			path: 'a.ts',
			status: 'done',
			diff: '@@ -1 +1 @@\n-a\n+b\n'
		}
	]);
	assert.equal(files.length, 1);
	assert.equal(files[0]!.path, 'a.ts');
	assert.ok((files[0]!.add ?? 0) + (files[0]!.del ?? 0) > 0);
});
