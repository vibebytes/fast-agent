import test from 'node:test';
import assert from 'node:assert/strict';
import {
	applyBridgeEvent,
	createTranscriptState,
	planBuildDisplayContent,
	planBuildSubmitText,
	projectSessionView,
	toTimelineItems
} from './index.js';

const samplePlan = {
	planId: 'plan-abc',
	name: 'Ship auth',
	overview: 'Add login without SSO',
	todos: [
		{id: 'routes', content: 'Wire routes', status: 'pending' as const},
		{id: 'tests', content: 'Add tests', status: 'pending' as const}
	],
	body: '## Approach\nUse existing session store.'
};

test('planBuildSubmitText embeds exact plan_id template', () => {
	assert.equal(
		planBuildSubmitText('plan-abc'),
		'Execute the plan with plan_id=plan-abc. Follow its todos and call upsert_plan update as you complete steps.'
	);
});

test('planBuildDisplayContent prefers name then short plan_id', () => {
	assert.equal(planBuildDisplayContent('Ship auth', 'plan-abc'), '执行计划：Ship auth');
	assert.equal(planBuildDisplayContent('', 'abcdefghij'), '执行计划：abcdefgh');
});

test('turn_started plan_build binds Build Dock fields on user row', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		sessionId: 's1',
		turnId: 'client_pb',
		clientMessageId: 'client_pb',
		text: '执行计划：Dock Plan',
		messageType: 'plan_build',
		planId: 'plan-dock',
		planName: 'Dock Plan'
	} as never);

	const user = toTimelineItems(state).find(i => i.kind === 'user');
	assert.ok(user && user.kind === 'user');
	assert.equal(user.text, '执行计划：Dock Plan');
	assert.ok(user.planBuild);
	assert.equal(user.planBuild.planId, 'plan-dock');
	assert.equal(user.planBuild.name, 'Dock Plan');
});

test('turn_started plan_build with empty text still seeds PlanBuild user', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't-empty',
		clientMessageId: 't-empty',
		text: '',
		messageType: 'plan_build',
		planId: 'plan-empty',
		planName: 'Empty Text'
	} as never);
	const user = toTimelineItems(state).find(i => i.kind === 'user');
	assert.ok(user && user.kind === 'user');
	assert.equal(user.planBuild?.planId, 'plan-empty');
	assert.equal(user.text, '执行计划：Empty Text');
});

test('plan_build_submitted patches peer transcript without prior planBuild fields', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-peer',
		clientMessageId: 'client-peer',
		text: '执行计划：Peer'
	} as never);
	state = applyBridgeEvent(state, {
		type: 'plan_build_submitted',
		messageId: 'msg-pb',
		planId: 'plan-peer',
		content: '执行计划：Peer',
		name: 'Peer',
		runId: 'run-peer'
	} as never);
	const user = toTimelineItems(state).find(i => i.kind === 'user');
	assert.ok(user && user.kind === 'user');
	assert.equal(user.planBuild?.planId, 'plan-peer');
	assert.equal(user.planBuild?.name, 'Peer');
});

test('plan_build_submitted before turnId remap patches open user (no double insert)', () => {
	let state = createTranscriptState();
	// Bridge emits turn_started with clientMessageId as turnId first.
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-race',
		clientMessageId: 'client-race',
		text: '执行计划：Race'
	} as never);
	// Engine event carries server runId before input_accepted remaps entries.
	state = applyBridgeEvent(state, {
		type: 'plan_build_submitted',
		messageId: 'msg-race',
		planId: 'plan-race',
		content: '执行计划：Race',
		name: 'Race',
		runId: 'run-race'
	} as never);
	const users = toTimelineItems(state).filter(i => i.kind === 'user');
	assert.equal(users.length, 1, 'must not orphan-insert a second PlanBuild user');
	assert.equal(users[0]!.kind === 'user' && users[0]!.planBuild?.planId, 'plan-race');
	const assistants = state.entries.filter(e => e.role === 'assistant');
	assert.equal(assistants.length, 1);
	assert.equal(assistants[0]?.status, 'streaming');
});

test('idempotent turn_started remap keeps plan_build on user', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client_remap',
		clientMessageId: 'client_remap',
		text: '执行计划：Remap',
		messageType: 'plan_build',
		planId: 'plan-remap',
		planName: 'Remap'
	} as never);
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-remap',
		clientMessageId: 'client_remap',
		text: '执行计划：Remap',
		messageType: 'plan_build',
		planId: 'plan-remap',
		planName: 'Remap'
	} as never);
	const users = toTimelineItems(state).filter(i => i.kind === 'user');
	assert.equal(users.length, 1);
	assert.equal(users[0]!.kind === 'user' && users[0]!.planBuild?.planId, 'plan-remap');
});

test('session_restored plan_build user binds Build Dock', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess',
		turns: [
			{
				turnId: 'restored_pb',
				userText: '执行计划：Restored',
				assistantText: 'done',
				userMessageType: 'plan_build',
				planId: 'plan-restored',
				planName: 'Restored',
				tools: [],
				steps: []
			}
		]
	} as never);
	const user = toTimelineItems(state).find(i => i.kind === 'user');
	assert.ok(user && user.kind === 'user');
	assert.equal(user.planBuild?.planId, 'plan-restored');
	assert.equal(user.planBuild?.name, 'Restored');
});

test('projectSessionView showStop on plan_build for Build Dock Stop', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client_stop',
		clientMessageId: 'client_stop',
		text: '执行计划：Stop Dock',
		messageType: 'plan_build',
		planId: 'plan-stop',
		planName: 'Stop Dock'
	} as never);
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		sessionId: 's1',
		clientMessageId: 'client_stop',
		turnId: 'run-stop'
	} as never);
	const items = projectSessionView(state, [], {canCancel: true});
	const user = items.find(i => i.kind === 'user');
	assert.ok(user && user.kind === 'user');
	assert.equal(user.showStop, true);
	assert.ok(user.planBuild);
});

test('message_patched create projects Plan card fields (not from thin tool_result)', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'plan auth'
	});
	// Thin upsert_plan ack — must NOT become a rich Plan card.
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'u1',
		tool: 'upsert_plan',
		args: {action: 'create'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'u1',
		tool: 'upsert_plan',
		success: true,
		fields: {
			output: JSON.stringify({ok: true, plan_id: 'plan-abc', action: 'create'})
		}
	});
	assert.equal(
		toTimelineItems(state).some(i => i.kind === 'plan'),
		false,
		'thin tool_result must not render Plan card'
	);

	state = applyBridgeEvent(state, {
		type: 'message_patched',
		planId: 'plan-abc',
		action: 'create',
		name: samplePlan.name,
		overview: samplePlan.overview,
		todos: samplePlan.todos,
		body: samplePlan.body,
		turnId: 't1'
	});

	const planItem = toTimelineItems(state).find(i => i.kind === 'plan');
	assert.ok(planItem && planItem.kind === 'plan');
	assert.equal(planItem.planId, 'plan-abc');
	assert.equal(planItem.name, 'Ship auth');
	assert.equal(planItem.overview, 'Add login without SSO');
	assert.equal(planItem.body.includes('Approach'), true);
	assert.equal(planItem.todos.length, 2);
	assert.equal(planItem.todos[0]?.status, 'pending');
});

test('message_patched update refreshes todos by plan_id', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'go'
	});
	state = applyBridgeEvent(state, {
		type: 'message_patched',
		planId: 'plan-abc',
		action: 'create',
		name: samplePlan.name,
		overview: samplePlan.overview,
		todos: samplePlan.todos,
		body: samplePlan.body
	});
	state = applyBridgeEvent(state, {
		type: 'message_patched',
		messageId: 'plan-abc',
		action: 'update',
		todos: [
			{id: 'routes', content: 'Wire routes', status: 'completed'},
			{id: 'tests', content: 'Add tests', status: 'in_progress'}
		]
	});

	const planItem = toTimelineItems(state).find(i => i.kind === 'plan');
	assert.ok(planItem && planItem.kind === 'plan');
	assert.equal(planItem.name, 'Ship auth');
	assert.deepEqual(
		planItem.todos.map(t => t.status),
		['completed', 'in_progress']
	);
});

test('session_restored step.plan restores Plan card', () => {
	let state = createTranscriptState();
	const thinTool = {
		id: 'u1',
		tool: 'upsert_plan',
		status: 'success',
		summary: '{"ok":true,"plan_id":"p1","action":"create"}'
	};
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess',
		turns: [
			{
				turnId: 'restored_0',
				userText: 'plan it',
				assistantText: '',
				// Flat tools + steps (Bridge RestoredTurn always fills both).
				tools: [thinTool],
				steps: [
					{
						tools: [thinTool],
						plan: {
							planId: 'p1',
							name: 'Auth',
							overview: 'Login',
							todos: [{id: 'a', content: 'routes', status: 'pending'}],
							body: 'Details'
						}
					}
				]
			}
		]
	});
	const items = toTimelineItems(state);
	const planItem = items.find(i => i.kind === 'plan');
	assert.ok(planItem && planItem.kind === 'plan');
	assert.equal(planItem.planId, 'p1');
	assert.equal(planItem.name, 'Auth');
	assert.equal(planItem.todos[0]?.content, 'routes');
	// Thin tool ack still present as a tool card, but Plan is separate.
	assert.ok(items.some(i => i.kind === 'tool' && i.tool === 'upsert_plan'));
});

test('message_patched accepts payloadJson', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'message_patched',
		planId: 'pj-1',
		action: 'create',
		payloadJson: JSON.stringify({
			name: 'From JSON',
			overview: 'O',
			todos: [{id: 'x', content: 'step', status: 'pending'}],
			body: 'B'
		})
	});
	const planItem = toTimelineItems(state).find(i => i.kind === 'plan');
	assert.ok(planItem && planItem.kind === 'plan');
	assert.equal(planItem.name, 'From JSON');
	assert.equal(planItem.todos[0]?.id, 'x');
});
