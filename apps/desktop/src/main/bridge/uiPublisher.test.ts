import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {WorkspaceHub} from './WorkspaceHub.js';
import {BridgeClient} from './BridgeClient.js';
import {CONTENT_PATCH_COALESCE_MS} from './uiPublish.js';
import {createUiPublisher} from './uiPublisher.js';
import type {UiSend} from '@fast-ide/session-view';

function tempDir(label: string): string {
	const root = mkdtempSync(join(tmpdir(), `ui-pub-${label}-`));
	mkdirSync(root, {recursive: true});
	return root;
}

function fakeBridge(commands: BridgeCommand[]) {
	return {
		start() {},
		stop() {},
		send(cmd: BridgeCommand) {
			commands.push(cmd);
			return true;
		},
		onEvent(_h: (e: BridgeEvent) => void) {},
		onError(_h: (m: string) => void) {},
		onExit(_h: (c: number | null, s: NodeJS.Signals | null) => void) {},
		onLog(_h: (m: string) => void) {}
	} as unknown as BridgeClient;
}

test('publishWorkspace: channel order cancel coalesce → patch → projects → project → tasks(meta)', () => {
	const home = tempDir('home');
	const projectRoot = tempDir('proj');
	const commands: BridgeCommand[] = [];
	const sent: Array<{channel: string; payload: unknown}> = [];
	const hub = new WorkspaceHub({
		homeDir: home,
		createBridge: () => fakeBridge(commands),
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		createClientId: () => 'cli'
	});
	const publisher = createUiPublisher({
		hub,
		send: ((channel, payload) => sent.push({channel, payload})) as UiSend
	});

	hub.openProject(projectRoot, {
		onEvent: () => {},
		onError: () => {},
		onExit: () => {}
	});
	hub.getActive()?.sessions.createTask('T');
	sent.length = 0;

	publisher.publishWorkspace();

	const channels = sent.map(s => s.channel);
	assert.deepEqual(channels.slice(0, 4), [
		'transcript:patched',
		'projects:changed',
		'project:changed',
		'tasks:changed'
	]);
	const tasks = sent.find(s => s.channel === 'tasks:changed')?.payload as {
		gate: unknown;
		queue: unknown[];
		transcript?: unknown;
	};
	assert.ok(tasks.gate);
	assert.equal(tasks.transcript, undefined);
});

test('publishTasksMeta: only tasks:changed (no projects rebuild)', () => {
	const home = tempDir('home-meta');
	const projectRoot = tempDir('proj-meta');
	const commands: BridgeCommand[] = [];
	const sent: Array<{channel: string; payload: unknown}> = [];
	const hub = new WorkspaceHub({
		homeDir: home,
		createBridge: () => fakeBridge(commands),
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		createClientId: () => 'cli'
	});
	const publisher = createUiPublisher({
		hub,
		send: ((channel, payload) => sent.push({channel, payload})) as UiSend
	});
	hub.openProject(projectRoot, {onEvent: () => {}, onError: () => {}, onExit: () => {}});
	hub.getActive()?.sessions.createTask('T');
	sent.length = 0;
	publisher.publishTasksMeta();
	assert.deepEqual(
		sent.map(s => s.channel),
		['tasks:changed']
	);
});

test('content events coalesce into one transcript patch', () => {
	const home = tempDir('home-c');
	const projectRoot = tempDir('proj-c');
	const commands: BridgeCommand[] = [];
	const sent: Array<{channel: string; payload: unknown}> = [];
	const timers: Array<{id: number; fn: () => void; ms: number}> = [];
	let nextId = 1;

	const hub = new WorkspaceHub({
		homeDir: home,
		createBridge: () => fakeBridge(commands),
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		createClientId: () => 'cli'
	});
	const publisher = createUiPublisher({
		hub,
		send: ((channel, payload) => sent.push({channel, payload})) as UiSend,
		setTimeoutFn: ((fn: () => void, ms: number) => {
			const id = nextId++;
			timers.push({id, fn, ms});
			return id as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout,
		clearTimeoutFn: ((id: ReturnType<typeof setTimeout>) => {
			const idx = timers.findIndex(t => t.id === (id as unknown as number));
			if (idx >= 0) timers.splice(idx, 1);
		}) as typeof clearTimeout
	});

	const handlers = {
		onEvent: (projectId: string, event: BridgeEvent) => publisher.handleEvent(projectId, event),
		onError: () => {},
		onExit: () => {}
	};
	hub.openProject(projectRoot, handlers);
	const projectId = hub.getActive()!.id;
	hub.getActive()!.sessions.createTask('T');
	sent.length = 0;
	timers.length = 0;

	publisher.handleEvent(projectId, {
		type: 'assistant_delta',
		sessionId: 's1',
		text: 'a'
	} as BridgeEvent);
	publisher.handleEvent(projectId, {
		type: 'assistant_delta',
		sessionId: 's1',
		text: 'b'
	} as BridgeEvent);
	publisher.handleEvent(projectId, {
		type: 'reasoning_delta',
		sessionId: 's1',
		text: 'c'
	} as BridgeEvent);
	publisher.handleEvent(projectId, {
		type: 'proc_updated',
		sessionId: 's1',
		procId: 'p1',
		status: 'running',
		command: 'pnpm test'
	} as BridgeEvent);
	publisher.handleEvent(projectId, {
		type: 'background_task_output',
		sessionId: 's1',
		procId: 'p1',
		text: 'ok'
	} as BridgeEvent);

	assert.equal(timers.length, 1);
	assert.equal(timers[0]!.ms, CONTENT_PATCH_COALESCE_MS);
	assert.equal(sent.filter(s => s.channel === 'transcript:patched').length, 0);
	assert.equal(sent.some(s => s.channel === 'projects:changed'), false);
	assert.equal(sent.some(s => s.channel === 'tasks:changed'), false);

	timers[0]!.fn();
	assert.equal(sent.filter(s => s.channel === 'transcript:patched').length, 1);
});

test('non-active Project stream events publish nothing (delta not whitelisted)', () => {
	const home = tempDir('home-f');
	const a = tempDir('proj-a');
	const b = tempDir('proj-b');
	const commands: BridgeCommand[] = [];
	const sent: Array<{channel: string; payload: unknown}> = [];

	const hub = new WorkspaceHub({
		homeDir: home,
		createBridge: () => fakeBridge(commands),
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		createClientId: () => 'cli'
	});
	const publisher = createUiPublisher({
		hub,
		send: ((channel, payload) => sent.push({channel, payload})) as UiSend
	});
	const handlers = {
		onEvent: (projectId: string, event: BridgeEvent) => publisher.handleEvent(projectId, event),
		onError: () => {},
		onExit: () => {}
	};
	hub.openProject(a, handlers);
	hub.openProject(b, handlers);
	const projA = hub.listProjects().find(p => p.path === a)!;
	hub.focusProject(hub.listProjects().find(p => p.path === b)!.id);
	sent.length = 0;

	publisher.handleEvent(projA.id, {
		type: 'assistant_delta',
		sessionId: 'foreign',
		text: 'x'
	} as BridgeEvent);

	// P2-13: raw deltas no longer cross IPC — no renderer surface consumes them.
	assert.equal(sent.length, 0);
});

test('buildTasksSnapshot carries transcript; buildTasksMeta has no body fields', () => {
	const home = tempDir('home-b');
	const projectRoot = tempDir('proj-b');
	const commands: BridgeCommand[] = [];
	const hub = new WorkspaceHub({
		homeDir: home,
		createBridge: () => fakeBridge(commands),
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		createClientId: () => 'cli'
	});
	const publisher = createUiPublisher({
		hub,
		send: (() => {}) as UiSend
	});
	hub.openProject(projectRoot, {
		onEvent: () => {},
		onError: () => {},
		onExit: () => {}
	});
	hub.getActive()!.sessions.createTask('T');

	const full = publisher.buildTasksSnapshot();
	assert.ok(Array.isArray(full.transcript));
	assert.ok(Array.isArray(full.approvals));
	assert.ok(full.bodyRevision);
	const meta = publisher.buildTasksMeta();
	assert.equal('transcript' in meta, false);
	assert.equal('bodyRevision' in meta, false);
	assert.equal(meta.activeTaskId, full.activeTaskId);
});

test('publishFocusChange: single workspace:focus without projectTasks', () => {
	const home = tempDir('home-f2');
	const projectRoot = tempDir('proj-f2');
	const commands: BridgeCommand[] = [];
	const sent: Array<{channel: string; payload: unknown}> = [];
	const timers: Array<{fn: () => void; ms: number}> = [];
	const hub = new WorkspaceHub({
		homeDir: home,
		createBridge: () => fakeBridge(commands),
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		createClientId: () => 'cli'
	});
	const publisher = createUiPublisher({
		hub,
		send: ((channel, payload) => sent.push({channel, payload})) as UiSend,
		setTimeoutFn: ((fn: () => void, ms: number) => {
			timers.push({fn, ms});
			return timers.length as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout,
		clearTimeoutFn: (() => {}) as typeof clearTimeout
	});

	hub.openProject(projectRoot, {
		onEvent: () => {},
		onError: () => {},
		onExit: () => {}
	});
	hub.getActive()?.sessions.createTask('T');
	sent.length = 0;

	publisher.publishFocusChange(3);

	const channels = sent.map(s => s.channel);
	assert.deepEqual(channels, ['workspace:focus']);
	assert.equal(sent.some(s => s.channel === 'projects:changed'), false);
	assert.equal(sent.some(s => s.channel === 'tasks:changed'), false);
	assert.equal(sent.some(s => s.channel === 'transcript:patched'), false);
	const focus = sent[0]!.payload as {
		focusEpoch: number;
		projects: unknown[];
		activeProjectId: string | null;
		activeTaskId: string | null;
		bodyRevision?: number;
		transcript?: unknown;
		projectTasks?: unknown;
	};
	assert.equal(focus.focusEpoch, 3);
	assert.ok(focus.activeProjectId);
	assert.ok(focus.activeTaskId);
	// Slim focus (perf doc P1-6): no Transcript body on the focus packet.
	assert.equal(focus.transcript, undefined);
	assert.equal(focus.projectTasks, undefined);
	assert.ok(focus.bodyRevision, 'slim focus carries a body freshness token');
	assert.equal(timers.length, 0, 'a fresh cached body avoids full serialization on focus');

	sent.length = 0;
	publisher.publishFocusChange(4);
	const unchanged = sent[0]!.payload as {bodyRevision?: number};
	assert.equal(unchanged.bodyRevision, focus.bodyRevision, 'unchanged body keeps its revision');

	const active = hub.getActive()!.sessions.getActiveTask()!;
	active.transcript = {
		...active.transcript,
		entries: [
			...active.transcript.entries,
			{id: 'new-body', role: 'assistant', text: 'changed', status: 'done'}
		]
	};
	sent.length = 0;
	publisher.publishFocusChange(5);
	const changed = sent[0]!.payload as {bodyRevision?: number};
	assert.ok(
		(changed.bodyRevision ?? 0) > (focus.bodyRevision ?? 0),
		'background body mutation advances the focus revision'
	);
});

test('publishFocusChange payload carries no body sections (P1-6 contract)', () => {
	const home = tempDir('home-slim');
	const projectRoot = tempDir('proj-slim');
	const commands: BridgeCommand[] = [];
	const sent: Array<{channel: string; payload: unknown}> = [];
	const hub = new WorkspaceHub({
		homeDir: home,
		createBridge: () => fakeBridge(commands),
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		createClientId: () => 'cli'
	});
	const publisher = createUiPublisher({
		hub,
		send: ((channel, payload) => sent.push({channel, payload})) as UiSend
	});
	hub.openProject(projectRoot, {onEvent: () => {}, onError: () => {}, onExit: () => {}});
	hub.getActive()?.sessions.createTask('T');
	sent.length = 0;
	publisher.publishFocusChange();
	const focus = sent[0]!.payload as Record<string, unknown>;
	for (const key of ['transcript', 'approvals', 'questions', 'codeChanges', 'liveProcs', 'liveTasks']) {
		assert.equal(key in focus, false, `${key} must not ride the focus packet`);
	}
	assert.ok('goalCard' in focus, 'goalCard stays host truth on focus');
	assert.ok('gate' in focus);
});

test('Heartbeat / Ack → bridge:event only', () => {
	const home = tempDir('home-h');
	const projectRoot = tempDir('proj-h');
	const commands: BridgeCommand[] = [];
	const sent: Array<{channel: string; payload: unknown}> = [];
	const hub = new WorkspaceHub({
		homeDir: home,
		createBridge: () => fakeBridge(commands),
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		createClientId: () => 'cli'
	});
	const publisher = createUiPublisher({
		hub,
		send: ((channel, payload) => sent.push({channel, payload})) as UiSend
	});
	hub.openProject(projectRoot, {
		onEvent: () => {},
		onError: () => {},
		onExit: () => {}
	});
	const projectId = hub.getActive()!.id;
	sent.length = 0;

	publisher.handleEvent(projectId, {type: 'Heartbeat'} as BridgeEvent);
	// P2-13: keepalives publish nothing at all.
	assert.equal(sent.length, 0);
});

test('checkpoint push reaches the renderer without rebuilding the workspace chrome', async () => {
	const home = tempDir('home-c');
	const projectRoot = tempDir('proj-c');
	const commands: BridgeCommand[] = [];
	const sent: Array<{channel: string; payload: unknown}> = [];
	const hub = new WorkspaceHub({
		homeDir: home,
		createBridge: () => fakeBridge(commands),
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		createClientId: () => 'cli'
	});
	const publisher = createUiPublisher({
		hub,
		send: ((channel, payload) => sent.push({channel, payload})) as UiSend
	});
	hub.openProject(projectRoot, {
		onEvent: () => {},
		onError: () => {},
		onExit: () => {}
	});
	const projectId = hub.getActive()!.id;
	sent.length = 0;

	publisher.handleEvent(projectId, {
		type: 'review_changed',
		pathHash: 'ab12',
		revision: 4
	} as BridgeEvent);
	publisher.handleEvent(projectId, {
		type: 'tree_advanced',
		pathHash: 'ab12',
		fromTree: 'a',
		toTree: 'b',
		cause: 'restore'
	} as BridgeEvent);

	// The drawer re-reads its own list from these; Projects/Tasks render nothing that moved.
	assert.deepEqual(
		sent.map(s => s.channel),
		['bridge:event', 'bridge:event']
	);
	await new Promise<void>(resolve => queueMicrotask(resolve));
	assert.deepEqual(sent.slice(2), []);
});

test('whitelisted events forward bridge:event; snapshot publish coalesces per microtask', async () => {
	const home = tempDir('home-w');
	const projectRoot = tempDir('proj-w');
	const commands: BridgeCommand[] = [];
	const sent: Array<{channel: string; payload: unknown}> = [];
	const hub = new WorkspaceHub({
		homeDir: home,
		createBridge: () => fakeBridge(commands),
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		createClientId: () => 'cli'
	});
	const publisher = createUiPublisher({
		hub,
		send: ((channel, payload) => sent.push({channel, payload})) as UiSend
	});
	hub.openProject(projectRoot, {onEvent: () => {}, onError: () => {}, onExit: () => {}});
	const projectId = hub.getActive()!.id;
	hub.getActive()?.sessions.createTask('T');
	sent.length = 0;

	publisher.handleEvent(projectId, {type: 'task_updated'} as BridgeEvent);
	publisher.handleEvent(projectId, {type: 'goal_updated'} as BridgeEvent);

	// Sync: only the raw passthroughs; the two snapshot publishes coalesce.
	assert.deepEqual(
		sent.map(s => s.channel),
		['bridge:event', 'bridge:event']
	);
	await new Promise<void>(resolve => queueMicrotask(resolve));
	const snapshotChannels = sent.slice(2).map(s => s.channel);
	assert.deepEqual(snapshotChannels, [
		'transcript:patched',
		'projects:changed',
		'project:changed',
		'tasks:changed'
	]);
});

test('turn_finished after a live run publishes completion:cue', () => {
	const home = tempDir('home-cue');
	const projectRoot = tempDir('proj-cue');
	const commands: BridgeCommand[] = [];
	const sent: Array<{channel: string; payload: unknown}> = [];
	const hub = new WorkspaceHub({
		homeDir: home,
		createBridge: () => fakeBridge(commands),
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		createClientId: () => 'cli'
	});
	const publisher = createUiPublisher({
		hub,
		send: ((channel, payload) => sent.push({channel, payload})) as UiSend
	});
	hub.openProject(projectRoot, {onEvent: () => {}, onError: () => {}, onExit: () => {}});
	const project = hub.getActive()!;
	const task = project.sessions.createTask('T');
	project.sessions.acceptNewSession('sess', task.id);
	project.sessions.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	project.sessions.handleEvent({
		type: 'turn_started',
		sessionId: 'sess',
		turnId: 't1',
		text: 'hi'
	} as BridgeEvent);
	sent.length = 0;
	project.sessions.handleEvent({
		type: 'turn_finished',
		sessionId: 'sess',
		turnId: 't1',
		success: true
	} as BridgeEvent);
	publisher.handleEvent(project.id, {
		type: 'turn_finished',
		sessionId: 'sess',
		turnId: 't1',
		success: true
	} as BridgeEvent);
	const cue = sent.find(s => s.channel === 'completion:cue');
	assert.deepEqual(cue?.payload, {taskId: task.id, success: true});
});

test('run_done after a live run publishes completion:cue', () => {
	const home = tempDir('home-cue-run');
	const projectRoot = tempDir('proj-cue-run');
	const commands: BridgeCommand[] = [];
	const sent: Array<{channel: string; payload: unknown}> = [];
	const hub = new WorkspaceHub({
		homeDir: home,
		createBridge: () => fakeBridge(commands),
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		createClientId: () => 'cli'
	});
	const publisher = createUiPublisher({
		hub,
		send: ((channel, payload) => sent.push({channel, payload})) as UiSend
	});
	hub.openProject(projectRoot, {onEvent: () => {}, onError: () => {}, onExit: () => {}});
	const project = hub.getActive()!;
	const task = project.sessions.createTask('T');
	project.sessions.acceptNewSession('sess', task.id);
	project.sessions.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	project.sessions.handleEvent({
		type: 'turn_started',
		sessionId: 'sess',
		turnId: 't1',
		text: 'hi'
	} as BridgeEvent);
	sent.length = 0;
	project.sessions.handleEvent({
		type: 'run_done',
		sessionId: 'sess',
		runId: 't1',
		success: true,
		summary: 'ok'
	} as BridgeEvent);
	publisher.handleEvent(project.id, {
		type: 'run_done',
		sessionId: 'sess',
		runId: 't1',
		success: true,
		summary: 'ok'
	} as BridgeEvent);
	const cue = sent.find(s => s.channel === 'completion:cue');
	assert.deepEqual(cue?.payload, {taskId: task.id, success: true});
});

test('turn_finished cue also notifies the OS sink with the task title', () => {
	const home = tempDir('home-notify-cue');
	const projectRoot = tempDir('proj-notify-cue');
	const commands: BridgeCommand[] = [];
	const sent: Array<{channel: string; payload: unknown}> = [];
	const notified: Array<Record<string, unknown>> = [];
	const hub = new WorkspaceHub({
		homeDir: home,
		createBridge: () => fakeBridge(commands),
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		createClientId: () => 'cli'
	});
	const publisher = createUiPublisher({
		hub,
		send: ((channel, payload) => sent.push({channel, payload})) as UiSend,
		notify: {notify: input => notified.push({...input})}
	});
	hub.openProject(projectRoot, {onEvent: () => {}, onError: () => {}, onExit: () => {}});
	const project = hub.getActive()!;
	const task = project.sessions.createTask('T');
	project.sessions.acceptNewSession('sess', task.id);
	project.sessions.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	project.sessions.handleEvent({
		type: 'turn_started',
		sessionId: 'sess',
		turnId: 't1',
		text: 'hi'
	} as BridgeEvent);
	sent.length = 0;
	notified.length = 0;
	project.sessions.handleEvent({
		type: 'turn_finished',
		sessionId: 'sess',
		turnId: 't1',
		success: true
	} as BridgeEvent);
	publisher.handleEvent(project.id, {
		type: 'turn_finished',
		sessionId: 'sess',
		turnId: 't1',
		success: true
	} as BridgeEvent);
	assert.deepEqual(notified, [
		{kind: 'turn_finished', taskId: task.id, taskTitle: 'T', success: true}
	]);
});

test('approval_requested notifies the OS sink even on background projects', () => {
	const home = tempDir('home-notify-ap');
	const a = tempDir('proj-na');
	const b = tempDir('proj-nb');
	const commands: BridgeCommand[] = [];
	const sent: Array<{channel: string; payload: unknown}> = [];
	const notified: Array<Record<string, unknown>> = [];
	const hub = new WorkspaceHub({
		homeDir: home,
		createBridge: () => fakeBridge(commands),
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		createClientId: () => 'cli'
	});
	const handlers = {
		onEvent: (projectId: string, event: BridgeEvent) => publisher.handleEvent(projectId, event),
		onError: () => {},
		onExit: () => {}
	};
	const publisher = createUiPublisher({
		hub,
		send: ((channel, payload) => sent.push({channel, payload})) as UiSend,
		notify: {notify: input => notified.push({...input})}
	});
	hub.openProject(a, handlers);
	hub.openProject(b, handlers);
	const projA = hub.getById(hub.listProjects().find(p => p.path === a)!.id)!;
	hub.focusProject(hub.listProjects().find(p => p.path === b)!.id);
	const task = projA.sessions.createTask('T');
	projA.sessions.acceptNewSession('sess', task.id);
	sent.length = 0;
	notified.length = 0;

	publisher.handleEvent(projA.id, {
		type: 'approval_requested',
		sessionId: 'sess',
		id: 'ap1',
		tool: 'bash',
		description: 'rm -rf build'
	} as BridgeEvent);

	assert.deepEqual(notified, [
		{kind: 'approval', taskId: task.id, taskTitle: 'T', detail: 'rm -rf build'}
	]);
});
