/**
 * Multi-task / multi-project isolation — integration cases matching the user symptom:
 * new empty task must not inherit shell cards, transcript turns, or Code Changes from
 * another task (same project or another project), including late Engine events.
 *
 * Run: pnpm --filter @fast-ide/desktop exec tsx --test src/main/bridge/taskIsolation.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {SessionController} from './SessionController.js';
import {WorkspaceHub} from './WorkspaceHub.js';
import {BridgeClient} from './BridgeClient.js';
import {projectHash} from './projectHash.js';
import {isSessionStreamEvent} from './sessionStreamEvents.js';

function withSid(sessionId: string, event: BridgeEvent): BridgeEvent {
	if (!isSessionStreamEvent(event.type)) return event;
	return {...event, sessionId} as BridgeEvent;
}

function controller(opts?: {
	createId?: () => string;
	projectId?: () => string;
	workspaceId?: () => string;
	now?: () => number;
}): {ctl: SessionController; sent: BridgeCommand[]} {
	const sent: BridgeCommand[] = [];
	let n = 0;
	const ctl = new SessionController({
		clientId: 'iso-cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: opts?.createId ?? (() => `task-${++n}`),
		projectId: opts?.projectId,
		workspaceId: opts?.workspaceId,
		now: opts?.now ?? (() => 1_000_000)
	});
	return {ctl, sent};
}

/** Seed task A with the screenshot-shaped residue: shell card + write (Code Changes). */
function seedBusyTask(ctl: SessionController, sessionId: string, title: string): string {
	const task = ctl.createTask(title);
	ctl.acceptNewSession(sessionId, task.id);
	ctl.handleEvent({type: 'Attached', sessionId, clientId: 'iso-cli'});
	ctl.handleEvent(
		withSid(sessionId, {
			type: 'turn_started',
			turnId: 'run-a',
			clientMessageId: 'msg-a',
			text: 'check python'
		})
	);
	ctl.handleEvent(
		withSid(sessionId, {
			type: 'tool_started',
			id: 'tool-shell-1',
			tool: 'shell',
			args: {
				command:
					'date && which python3 && python3 -c "import akshare; print(\'akshare\', akshare.__version__)" 2>/dev/null || echo "no akshare"'
			}
		})
	);
	ctl.handleEvent(
		withSid(sessionId, {
			type: 'tool_finished',
			id: 'tool-shell-1',
			tool: 'shell',
			success: true,
			fields: {
				output:
					'2026年 7月17日 星期五 09时18分15秒 CST\n/usr/local/bin/python3\nakshare 1.1.22'
			}
		})
	);
	ctl.handleEvent(
		withSid(sessionId, {
			type: 'tool_started',
			id: 'tool-write-1',
			tool: 'write_file',
			args: {path: 'src/demo.py', description: 'demo'}
		})
	);
	ctl.handleEvent(
		withSid(sessionId, {
			type: 'tool_finished',
			id: 'tool-write-1',
			tool: 'write_file',
			success: true,
			fields: {path: 'src/demo.py', diff: '@@ -0,0 +1 @@\n+print(1)\n'}
		})
	);
	ctl.handleEvent(withSid(sessionId, {type: 'turn_finished', turnId: 'run-a', success: true}));
	return task.id;
}

function assertEmptyTask(
	ctl: SessionController,
	taskId: string,
	label: string
): void {
	const task = ctl.listTasks().find(t => t.id === taskId);
	assert.ok(task, `${label}: task missing`);
	assert.equal(task.transcript.entries.length, 0, `${label}: transcript must be empty`);
	assert.equal(task.codeChanges.entries.length, 0, `${label}: codeChanges must be empty`);
	const texts = task.transcript.entries.map(e => e.text ?? '').join('\n');
	assert.equal(texts.includes('akshare'), false, `${label}: must not contain prior shell residue`);
	assert.equal(texts.includes('demo.py'), false, `${label}: must not contain prior write path`);
}

// ── Same project ────────────────────────────────────────────────────────────

test('ISO-1: createTask after busy task starts empty (transcript + codeChanges)', () => {
	const {ctl} = controller();
	const aId = seedBusyTask(ctl, 'sess-a', 'Busy A');
	const a = ctl.listTasks().find(t => t.id === aId)!;
	assert.ok(a.transcript.entries.length > 0, 'fixture: A has transcript');
	assert.ok(a.codeChanges.entries.length > 0, 'fixture: A has code changes');

	const b = ctl.createTask('New task');
	assert.equal(ctl.getActiveTask()?.id, b.id);
	assertEmptyTask(ctl, b.id, 'ISO-1 new task');

	// Prior task must keep its own residue (isolation both ways).
	const aAfter = ctl.listTasks().find(t => t.id === aId)!;
	assert.ok(aAfter.transcript.entries.some(e => (e.text ?? '').includes('check python')));
	assert.ok(aAfter.codeChanges.entries.some(e => e.path === 'src/demo.py'));
});

test('ISO-2: stale session_restored for prior session must not paint onto pending New task', () => {
	const {ctl} = controller();
	seedBusyTask(ctl, 'sess-a', 'Busy A');

	const pending = ctl.createTask('New task');
	assert.equal(pending.pendingNew, true);
	assert.equal(pending.sessionId, null);

	// Late / stray restore for the OLD session while New task is active+pending.
	ctl.handleEvent({
		type: 'session_restored',
		sessionId: 'sess-a',
		turns: [
			{
				turnId: 'stale-1',
				userText: 'check python',
				assistantText: 'akshare 1.1.22',
				tools: [
					{
						id: 'tool-shell-1',
						tool: 'shell',
						status: 'completed',
						args: {
							command: 'date && which python3 && python3 -c "import akshare"'
						},
						summary: 'akshare 1.1.22'
					}
				]
			}
		]
	});

	assertEmptyTask(ctl, pending.id, 'ISO-2 pending New');
	assert.equal(
		ctl.listTasks().find(t => t.id === pending.id)?.sessionId,
		null,
		'ISO-2: pending New must not bind to sess-a'
	);
});

test('ISO-3: stale ready for prior session must not bind pending New task', () => {
	const {ctl} = controller();
	seedBusyTask(ctl, 'sess-a', 'Busy A');
	const pending = ctl.createTask('New task');

	ctl.handleEvent({type: 'ready', sessionId: 'sess-a', protocolVersion: 2, mode: 'bridge'});

	assertEmptyTask(ctl, pending.id, 'ISO-3 pending New');
	assert.equal(
		ctl.listTasks().find(t => t.id === pending.id)?.sessionId,
		null,
		'ISO-3: ready(sess-a) must not claim pending New'
	);
});

test('ISO-4: stale Attached for prior session must not claim pending New task', () => {
	const {ctl} = controller();
	seedBusyTask(ctl, 'sess-a', 'Busy A');
	const pending = ctl.createTask('New task');

	ctl.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'iso-cli'});

	assertEmptyTask(ctl, pending.id, 'ISO-4 pending New');
	assert.equal(
		ctl.listTasks().find(t => t.id === pending.id)?.sessionId,
		null,
		'ISO-4: Attached(sess-a) must not claim pending New'
	);
});

test('ISO-5: only acceptNewSession(sessionId, taskId) binds pending New', () => {
	const {ctl, sent} = controller({projectId: () => 'proj-1'});
	seedBusyTask(ctl, 'sess-a', 'Busy A');
	sent.length = 0;
	const pending = ctl.createTask('New task');
	assert.ok(sent.some(c => c.type === 'CreateSession'));
	const create = sent.find(c => c.type === 'CreateSession');
	if (create?.type === 'CreateSession') {
		assert.equal(create.taskId, pending.id);
	}

	// ready / empty restore must not bind.
	ctl.handleEvent({type: 'ready', sessionId: 'sess-b', protocolVersion: 2, mode: 'bridge'});
	ctl.handleEvent({type: 'session_restored', sessionId: 'sess-b', turns: []});
	assert.equal(pending.sessionId, null, 'ISO-5: side paths must not bind');

	ctl.acceptNewSession('sess-b', pending.id);
	ctl.handleEvent({type: 'Attached', sessionId: 'sess-b', clientId: 'iso-cli'});

	const b = ctl.listTasks().find(t => t.id === pending.id)!;
	assert.equal(b.sessionId, 'sess-b');
	assertEmptyTask(ctl, pending.id, 'ISO-5 new session empty');
});

test('ISO-6: live stream for sess-a must not land on focused New task for sess-b', () => {
	const {ctl} = controller();
	const aId = seedBusyTask(ctl, 'sess-a', 'Busy A');
	const pending = ctl.createTask('New task');
	ctl.acceptNewSession('sess-b', pending.id);
	ctl.handleEvent({type: 'Attached', sessionId: 'sess-b', clientId: 'iso-cli'});

	// New in-flight turn on A while B is focused (post-turn_finished deltas are
	// intentionally dropped by session-view — use a live turnId for demux proof).
	ctl.handleEvent(withSid('sess-a', {type: 'turn_started', turnId: 'run-a2', text: 'more'}));
	ctl.handleEvent(
		withSid('sess-a', {
			type: 'assistant_delta',
			turnId: 'run-a2',
			text: 'straggler from A: akshare'
		})
	);

	assertEmptyTask(ctl, pending.id, 'ISO-6 New task');
	const a = ctl.listTasks().find(t => t.id === aId)!;
	assert.ok(
		a.transcript.entries.some(e => (e.text ?? '').includes('straggler from A')),
		'ISO-6: stream for sess-a must land on A'
	);
});

// ── Cross project (WorkspaceHub) ────────────────────────────────────────────

type FakeBridge = BridgeClient & {
	__inject: (event: BridgeEvent) => void;
};

function createFakeBridge(commands: BridgeCommand[]): FakeBridge {
	const stdout = new PassThrough();
	const stdin = new PassThrough();
	const stderr = new PassThrough();
	const child = Object.assign(new EventEmitter(), {
		stdout,
		stderr,
		stdin,
		killed: false,
		pid: 1,
		kill(this: EventEmitter & {killed: boolean}) {
			this.killed = true;
			this.emit('exit', 0, null);
		}
	});

	const client = new BridgeClient({
		spawnImpl: () => child as never
	}) as FakeBridge;

	const origStart = client.start.bind(client);
	client.start = ((workspaceRoot, handlers, launchOptions = {}) => {
		origStart(workspaceRoot, handlers, {
			...launchOptions,
			env: {
				FAST_ENGINE_COMMAND: 'mock',
				FAST_ENGINE_ARGS: 'engine --mode bridge --transport stdio --new',
				...(launchOptions.env ?? {})
			},
			bundledEnginePath: '/unused',
			sessionMode: 'new'
		});
		queueMicrotask(() => {
			stdout.write(
				`${JSON.stringify({
					type: 'ready',
					protocolVersion: 2,
					sessionId: 'host-sess',
					cwd: workspaceRoot,
					mode: 'bridge'
				})}\n`
			);
		});
	}) as BridgeClient['start'];

	const origSend = client.send.bind(client);
	client.send = ((cmd: BridgeCommand) => {
		commands.push(cmd);
		const ok = origSend(cmd);
		if (cmd.type === 'RegisterWorkspace') {
			queueMicrotask(() => {
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'RegisterWorkspace',
						message: projectHash(cmd.path),
						status: 'accepted'
					})}\n`
				);
			});
		}
		if (cmd.type === 'CreateProject') {
			const rootPath = cmd.rootPath ?? '';
			queueMicrotask(() => {
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'CreateProject',
						message: 'ok',
						status: 'accepted',
						projectId: `meta-${projectHash(rootPath)}`,
						workspaceId: projectHash(rootPath)
					})}\n`
				);
			});
		}
		if (cmd.type === 'CreateSession') {
			const sid = `sess-${commands.filter(c => c.type === 'CreateSession').length}`;
			queueMicrotask(() => {
				stdout.write(
					`${JSON.stringify({
						type: 'session_restored',
						sessionId: sid,
						turns: []
					})}\n`
				);
				stdout.write(
					`${JSON.stringify({
						type: 'ready',
						protocolVersion: 2,
						sessionId: sid,
						mode: 'bridge'
					})}\n`
				);
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'CreateSession',
						message: `Started session ${sid}.`,
						status: 'accepted',
						sessionId: sid,
						projectId: cmd.projectId,
						taskId: cmd.taskId,
						workspaceId: projectHash(
							// best-effort: workspace from project stamp arrives via CreateProject
							''
						)
					})}\n`
				);
			});
		}
		return ok;
	}) as BridgeClient['send'];

	client.__inject = (event: BridgeEvent) => {
		stdout.write(`${JSON.stringify(event)}\n`);
	};

	return client;
}

function noopHandlers() {
	return {
		onEvent() {},
		onError() {},
		onExit() {},
		onStatus() {},
		onWorkspace() {},
		onFocus() {}
	};
}

test('ISO-7: cross-project — Project A residue must not appear on Project B new task', async () => {
	const commands: BridgeCommand[] = [];
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'iso-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'iso-home-'))
	});

	const rootA = mkdtempSync(path.join(tmpdir(), 'iso-proj-a-'));
	const rootB = mkdtempSync(path.join(tmpdir(), 'iso-proj-b-'));
	hub.openProject(rootA, noopHandlers());
	hub.openProject(rootB, noopHandlers());
	await new Promise(r => setTimeout(r, 120));

	const projA = hub.getById(hub.listProjects().find(p => p.path === rootA)!.id)!;
	const projB = hub.getById(hub.listProjects().find(p => p.path === rootB)!.id)!;

	hub.focusProject(projA.id);
	const aId = seedBusyTask(projA.sessions, 'sess-a', 'A busy');
	assert.ok((projA.sessions.listTasks().find(t => t.id === aId)?.codeChanges.entries.length ?? 0) > 0);

	hub.focusProject(projB.id);
	const bTask = projB.sessions.createTask('New task on B');
	assertEmptyTask(projB.sessions, bTask.id, 'ISO-7 B new task');

	// Stray A stream while B is focused.
	projA.sessions.handleEvent(
		withSid('sess-a', {
			type: 'assistant_delta',
			turnId: 'run-a',
			text: 'more akshare from A'
		})
	);
	assertEmptyTask(projB.sessions, bTask.id, 'ISO-7 B after A stream');

	hub.closeAll();
});

test('ISO-8: cross-project — unsigned/wrong-session restore must not fill focused New task on other project', async () => {
	const commands: BridgeCommand[] = [];
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'iso-host2-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'iso-home2-'))
	});

	const rootA = mkdtempSync(path.join(tmpdir(), 'iso-proj-a2-'));
	const rootB = mkdtempSync(path.join(tmpdir(), 'iso-proj-b2-'));
	hub.openProject(rootA, noopHandlers());
	hub.openProject(rootB, noopHandlers());
	await new Promise(r => setTimeout(r, 120));

	const projA = hub.getById(hub.listProjects().find(p => p.path === rootA)!.id)!;
	const projB = hub.getById(hub.listProjects().find(p => p.path === rootB)!.id)!;

	hub.focusProject(projA.id);
	seedBusyTask(projA.sessions, 'sess-a', 'A busy');

	hub.focusProject(projB.id);
	const bTask = projB.sessions.createTask('B pending');
	assert.equal(bTask.pendingNew, true);

	// Inject restore for A's session into B's controller (as if demux failed).
	projB.sessions.handleEvent({
		type: 'session_restored',
		sessionId: 'sess-a',
		turns: [
			{
				turnId: 'leak',
				userText: 'should not land on B',
				assistantText: 'akshare leak',
				tools: []
			}
		]
	});

	assertEmptyTask(projB.sessions, bTask.id, 'ISO-8 B pending');
	assert.equal(
		projB.sessions.listTasks().find(t => t.id === bTask.id)?.sessionId,
		null,
		'ISO-8: B must not bind to sess-a'
	);

	hub.closeAll();
});
