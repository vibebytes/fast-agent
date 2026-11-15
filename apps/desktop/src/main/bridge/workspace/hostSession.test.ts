import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import type {UiSend} from '@fast-ide/session-view';
import {BridgeClient} from '../BridgeClient.js';
import {WorkspaceHub} from '../WorkspaceHub.js';
import {createUiPublisher} from '../uiPublisher.js';
import {hostSession} from './hostSession.js';

function tempDir(label: string): string {
	const root = mkdtempSync(join(tmpdir(), `host-session-${label}-`));
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

function makeHarness(label: string) {
	const home = tempDir(`home-${label}`);
	const projectRoot = tempDir(`proj-${label}`);
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
	hub.ensureDefaultProject({onEvent: () => {}, onError: () => {}, onExit: () => {}});
	hub.openProject(projectRoot, {onEvent: () => {}, onError: () => {}, onExit: () => {}});
	const handlers = hostSession({
		hub,
		publisher,
		startHeartbeat: () => {},
		projectHandlers: () => ({}) as never,
		showInFolder: () => {},
		pathExists: () => false,
		readMedia: async () => {
			throw new Error('unused');
		}
	});
	return {hub, publisher, handlers, commands};
}

test('model:settings targets the passed task instead of the active task', () => {
	const {hub, handlers} = makeHarness('targeting');
	const sessions = hub.getActive()!.sessions;
	const a = sessions.createTask('A');
	const b = sessions.createTask('B');
	assert.equal(sessions.getActiveTask()?.id, b.id);
	const ok = handlers['model:settings'](
		{platform: 'openrouter', model: 'm1', effort: 'low', thinking: false},
		a.id
	);
	assert.equal(ok, true);
	const rowA = sessions.listTasks().find(t => t.id === a.id);
	assert.equal(rowA?.effort, 'low');
	assert.equal(rowA?.thinking, false);
	assert.equal(sessions.getActiveTask()?.effort, undefined);
});

test('model:settings and model:select resolve tasks in the Default Project while another project is active', () => {
	const {hub, handlers} = makeHarness('default-proj');
	const defaultSessions = hub.getDefaultProject()!.sessions;
	const defTask = defaultSessions.createTask('Default T');
	const activeSessions = hub.getActive()!.sessions;
	activeSessions.createTask('Active T');

	const okSettings = handlers['model:settings'](
		{platform: 'zhipu', model: 'glm-5.3-flash', effort: 'high', thinking: true},
		defTask.id
	);
	assert.equal(okSettings, true);
	const okSelect = handlers['model:select']('zhipu/glm-5.3-flash', defTask.id);
	assert.equal(okSelect, true);

	const updated = defaultSessions.listTasks().find(t => t.id === defTask.id);
	assert.equal(updated?.effort, 'high');
	assert.equal(updated?.thinking, true);
	assert.equal(updated?.model, 'zhipu/glm-5.3-flash');
	assert.equal(activeSessions.getActiveTask()?.effort, undefined);
});

test('mode:set targets the passed task and sends SetMode to that task session', () => {
	const {hub, handlers, commands} = makeHarness('mode-target');
	const sessions = hub.getActive()!.sessions;
	const a = sessions.createTask('A');
	const b = sessions.createTask('B');
	sessions.acceptNewSession('sess-a', a.id);
	sessions.acceptNewSession('sess-b', b.id);
	assert.equal(sessions.getActiveTask()?.id, b.id);
	const ok = handlers['mode:set']('plan', a.id);
	assert.equal(ok, true);
	assert.equal(sessions.listTasks().find(t => t.id === a.id)?.runMode, 'plan');
	assert.equal(sessions.getActiveTask()?.runMode, 'agent');
	const setMode = commands.filter(c => c.type === 'SetMode').at(-1) as
		| {sessionId?: string; mode?: string}
		| undefined;
	assert.equal(setMode?.sessionId, 'sess-a');
	assert.equal(setMode?.mode, 'plan');
});

test('new tasks do not inherit free/yolo from the active task', () => {
	const {hub} = makeHarness('new-mode');
	const sessions = hub.getActive()!.sessions;
	sessions.createTask('A');
	assert.equal(sessions.setRunMode('free'), true);
	assert.equal(sessions.createTask('New').runMode, 'agent');
	assert.equal(sessions.setRunMode('yolo'), true);
	assert.equal(sessions.createTask('New2').runMode, 'agent');
	assert.equal(sessions.setRunMode('plan'), true);
	assert.equal(sessions.createTask('New3').runMode, 'plan');
});
