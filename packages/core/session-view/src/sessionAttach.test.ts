import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {
	createSessionAttachStore,
	detachAllSessions,
	detachTargets,
	heartbeatAttached,
	requestSessionAttach,
	resolveEventTask,
	sessionIdFromEvent,
	settleAttachedEvent,
	type AttachableTask
} from './sessionAttach.js';

function makeTask(id: string, sessionId: string | null = null): AttachableTask {
	return {
		id,
		sessionId,
		pendingNew: false,
		pendingAttach: false,
		lastEventSeq: 0
	};
}

function streamEvent(sessionId: string): BridgeEvent {
	return {type: 'assistant_delta', sessionId, delta: 'x'} as unknown as BridgeEvent;
}

test('resolveEventTask prefers session-bound task and demuxes stream by session', () => {
	const bySession = makeTask('t1', 's1');
	const active = makeTask('t2', 's2');
	const deps = {
		findTaskBySession: (sid: string) => (sid === 's1' ? bySession : null),
		getActiveTask: () => active
	};
	assert.equal(resolveEventTask(streamEvent('s1'), 's1', deps), bySession);
	assert.equal(resolveEventTask(streamEvent('s9'), 's9', deps), null);
	const restored: BridgeEvent = {type: 'session_restored', sessionId: 's9'} as BridgeEvent;
	assert.equal(resolveEventTask(restored, 's9', deps), null);
	const host: BridgeEvent = {type: 'sessions_list'} as unknown as BridgeEvent;
	assert.equal(resolveEventTask(host, 's9', deps), active);
	const hostNoSession: BridgeEvent = {type: 'sessions_list'} as unknown as BridgeEvent;
	assert.equal(resolveEventTask(hostNoSession, undefined, deps), active);
});

test('settleAttachedEvent settles matching task and skips stray pendingNew (ISO-4/8)', () => {
	const attach = createSessionAttachStore();
	const existing = makeTask('t1', 's1');
	existing.pendingAttach = true;
	existing.pendingNew = true;
	const settled: string[] = [];
	settleAttachedEvent(
		{type: 'Attached', sessionId: 's1'} as unknown as BridgeEvent,
		{
			attach,
			findTaskBySession: sid => (sid === 's1' ? existing : null),
			getActiveTask: () => null,
			settleTask: task => {
				settled.push(task.id);
			}
		}
	);
	assert.ok(attach.isAttached('s1'));
	assert.equal(existing.pendingAttach, false);
	assert.equal(existing.pendingNew, false);
	assert.deepEqual(settled, ['t1']);

	const active = makeTask('t2', 's3');
	active.pendingNew = true;
	settleAttachedEvent(
		{type: 'Attached', sessionId: 's3'} as unknown as BridgeEvent,
		{
			attach,
			findTaskBySession: () => null,
			getActiveTask: () => active,
			settleTask: task => {
				settled.push(task.id);
			}
		}
	);
	assert.equal(active.pendingNew, true);
	assert.deepEqual(settled, ['t1']);

	const activePendingAttach = makeTask('t3', 's4');
	activePendingAttach.pendingAttach = true;
	settleAttachedEvent(
		{type: 'Attached', sessionId: 's4'} as unknown as BridgeEvent,
		{
			attach,
			findTaskBySession: () => null,
			getActiveTask: () => activePendingAttach,
			settleTask: task => {
				settled.push(task.id);
			}
		}
	);
	assert.equal(activePendingAttach.pendingAttach, false);
	assert.deepEqual(settled, ['t1', 't3']);
});

test('settleAttachedEvent ignores non-Attached events', () => {
	const attach = createSessionAttachStore();
	settleAttachedEvent(
		{type: 'Detached', sessionId: 's1'} as unknown as BridgeEvent,
		{
			attach,
			findTaskBySession: () => null,
			getActiveTask: () => null,
			settleTask: () => assert.fail('should not settle')
		}
	);
	assert.ok(!attach.isAttached('s1'));
});

test('requestSessionAttach drops duplicate stubs, keeps pendingAttach on send failure', () => {
	const attach = createSessionAttachStore();
	const task = makeTask('t1', null);
	const stub = makeTask('stub', 's1');
	stub.pendingNew = true;
	const tasks = new Map<string, AttachableTask>([
		['t1', task],
		['stub', stub]
	]);
	let ok = false;
	const sent: BridgeCommand[] = [];
	const result = requestSessionAttach({
		tasks,
		task,
		sessionId: 's1',
		send: cmd => {
			sent.push(cmd);
			return ok;
		},
		clientId: 'cli',
		attach,
		settleTask: () => {}
	});
	assert.equal(result, false);
	assert.ok(!tasks.has('stub'));
	assert.equal(task.pendingAttach, true);
	assert.ok(!attach.isAttached('s1'));

	ok = true;
	const result2 = requestSessionAttach({
		tasks,
		task,
		sessionId: 's1',
		lastEventSeq: 42,
		send: cmd => {
			sent.push(cmd);
			return ok;
		},
		clientId: 'cli',
		attach,
		settleTask: () => {}
	});
	assert.equal(result2, true);
	assert.equal(task.pendingAttach, false);
	assert.ok(attach.isAttached('s1'));
	const attachCmd = sent[1] as {type: string; sessionId: string; lastEventSeq: number};
	assert.equal(attachCmd.type, 'AttachSession');
	assert.equal(attachCmd.sessionId, 's1');
	assert.equal(attachCmd.lastEventSeq, 42);
});

test('attach store tracks ids order, restored set, and clears', () => {
	const store = createSessionAttachStore();
	assert.equal(store.size(), 0);
	assert.equal(store.first(), undefined);
	assert.ok(!store.isAttached('s1'));
	assert.ok(!store.isAttached(null));
	store.bind('s1');
	store.bind('s1');
	store.bind('s2');
	assert.deepEqual(store.ids(), ['s1', 's2']);
	assert.equal(store.first(), 's1');
	assert.equal(store.size(), 2);
	store.markRestored('s1');
	assert.ok(store.isRestored('s1'));
	assert.ok(!store.isRestored('s2'));
	store.clear();
	assert.equal(store.size(), 0);
	assert.ok(!store.isRestored('s1'));
});

test('sessionIdFromEvent reads only string sessionId', () => {
	assert.equal(sessionIdFromEvent(streamEvent('s1')), 's1');
	assert.equal(sessionIdFromEvent({type: 'sessions_list'} as unknown as BridgeEvent), undefined);
	assert.equal(
		sessionIdFromEvent({type: 'sessions_list', sessionId: 7} as unknown as BridgeEvent),
		undefined
	);
});

test('detachTargets dedupes attached first then bound tasks in order', () => {
	const targets = detachTargets(['s1', 's2'], [null, 's2', 's3', undefined]);
	assert.deepEqual(targets, ['s1', 's2', 's3']);
	assert.deepEqual(detachTargets([], []), []);
});

test('detachAllSessions sends DetachSession per attached id and clears the store', () => {
	const attach = createSessionAttachStore();
	attach.bind('s1');
	attach.bind('s2');
	const sent: BridgeCommand[] = [];
	detachAllSessions(attach, [null, 's2', 's3'], cmd => {
		sent.push(cmd);
		return true;
	}, 'cli');
	assert.deepEqual(
		sent.map(c => (c as {type: string; sessionId: string; clientId: string})),
		[
			{type: 'DetachSession', sessionId: 's1', clientId: 'cli'},
			{type: 'DetachSession', sessionId: 's2', clientId: 'cli'},
			{type: 'DetachSession', sessionId: 's3', clientId: 'cli'}
		]
	);
	assert.equal(attach.size(), 0);
});

test('heartbeatAttached emits one Heartbeat per attached session', () => {
	const attach = createSessionAttachStore();
	assert.equal(heartbeatAttached(attach, () => true, 'cli', 5), false);
	attach.bind('s1');
	attach.bind('s2');
	const sent: BridgeCommand[] = [];
	assert.equal(
		heartbeatAttached(
			attach,
			cmd => {
				sent.push(cmd);
				return true;
			},
			'cli',
			1_700_000_000_000
		),
		true
	);
	assert.deepEqual(sent.map(c => (c as {type: string; sessionId: string})), [
		{type: 'Heartbeat', sessionId: 's1', clientId: 'cli', atMillis: 1_700_000_000_000},
		{type: 'Heartbeat', sessionId: 's2', clientId: 'cli', atMillis: 1_700_000_000_000}
	]);
});
