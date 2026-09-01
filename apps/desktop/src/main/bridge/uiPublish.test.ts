import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	CONTENT_PATCH_COALESCE_MS,
	classifyBridgeEventForUi,
	createCoalescedPublisher
} from './uiPublish.js';

test('content coalesce targets 30ms streaming budget', () => {
	assert.equal(CONTENT_PATCH_COALESCE_MS, 30);
});

test('classifyBridgeEventForUi: Heartbeat/Ack → none', () => {
	assert.equal(classifyBridgeEventForUi('Heartbeat'), 'none');
	assert.equal(classifyBridgeEventForUi('Ack'), 'none');
	assert.equal(classifyBridgeEventForUi('workspace_file_changed'), 'none');
});

test('classifyBridgeEventForUi: content deltas → content', () => {
	assert.equal(classifyBridgeEventForUi('assistant_delta'), 'content');
	assert.equal(classifyBridgeEventForUi('reasoning_delta'), 'content');
	assert.equal(classifyBridgeEventForUi('tool_output'), 'content');
	assert.equal(classifyBridgeEventForUi('tool_started'), 'content');
	assert.equal(classifyBridgeEventForUi('tool_finished'), 'content');
	assert.equal(classifyBridgeEventForUi('proc_updated'), 'content');
	assert.equal(classifyBridgeEventForUi('background_task_output'), 'content');
	assert.equal(classifyBridgeEventForUi('background_task_completed'), 'content');
});

test('classifyBridgeEventForUi: structural/control → snapshot', () => {
	assert.equal(classifyBridgeEventForUi('ready'), 'snapshot');
	assert.equal(classifyBridgeEventForUi('session_restored'), 'snapshot');
	assert.equal(classifyBridgeEventForUi('approval_requested'), 'snapshot');
	assert.equal(classifyBridgeEventForUi('user_message'), 'snapshot');
	assert.equal(classifyBridgeEventForUi('turn_finished'), 'snapshot');
});

test('coalesced publisher flushes once after window', () => {
	const calls: number[] = [];
	const timers: Array<{id: number; fn: () => void; ms: number}> = [];
	let nextId = 1;
	const pub = createCoalescedPublisher(
		CONTENT_PATCH_COALESCE_MS,
		() => {
			calls.push(Date.now());
		},
		((fn: () => void, ms: number) => {
			const id = nextId++;
			timers.push({id, fn, ms});
			return id as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout,
		((id: ReturnType<typeof setTimeout>) => {
			const idx = timers.findIndex(t => t.id === (id as unknown as number));
			if (idx >= 0) timers.splice(idx, 1);
		}) as typeof clearTimeout
	);

	pub.schedule();
	pub.schedule();
	pub.schedule();
	assert.equal(timers.length, 1);
	assert.equal(timers[0]!.ms, CONTENT_PATCH_COALESCE_MS);
	assert.equal(calls.length, 0);
	timers[0]!.fn();
	assert.equal(calls.length, 1);
	assert.equal(pub.pending(), false);
});

test('flushNow cancels pending timer and flushes immediately', () => {
	let flushes = 0;
	const timers: Array<{id: number; fn: () => void}> = [];
	let nextId = 1;
	const pub = createCoalescedPublisher(
		75,
		() => {
			flushes += 1;
		},
		((fn: () => void) => {
			const id = nextId++;
			timers.push({id, fn});
			return id as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout,
		((id: ReturnType<typeof setTimeout>) => {
			const idx = timers.findIndex(t => t.id === (id as unknown as number));
			if (idx >= 0) timers.splice(idx, 1);
		}) as typeof clearTimeout
	);
	pub.schedule();
	assert.equal(timers.length, 1);
	pub.flushNow();
	assert.equal(flushes, 1);
	assert.equal(timers.length, 0);
});
