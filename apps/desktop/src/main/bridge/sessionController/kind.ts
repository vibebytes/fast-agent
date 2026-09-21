/** SessionController tests — engine kind / model settings. Loaded by SessionController.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	applyBridgeEvent,
	chromeAwaitingSettlement,
	chromeFromServer,
	chromeRunId,
	createTranscriptState,
	type TranscriptState
} from '@fast-ide/session-view';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {SessionController} from '../SessionController.js';
import {assertSkillCommandPinned} from '../skillSlashContract.js';
import {cueController, withSid} from './kit.js';

test('setRunMode / setModelSettings stick on Task and restore on selectTask', () => {
	const sent: BridgeCommand[] = [];
	let n = 0;
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-1',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => `id-${++n}`
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id, 'ws-1');
	assert.equal(controller.setRunMode('plan'), true);
	assert.equal(controller.setModelSettings({
		platform: 'openrouter',
		model: 'claude-sonnet-4',
		effort: 'high',
		thinking: true
	}), true);
	assert.equal(controller.runMode, 'plan');
	assert.equal(controller.effort, 'high');
	assert.equal(controller.thinking, true);
	assert.equal(controller.getActiveTask()?.runMode, 'plan');

	const b = controller.createTask('B');
	controller.acceptNewSession('sess-b', b.id, 'ws-1');
	assert.equal(controller.setRunMode('ask'), true);
	assert.equal(controller.runMode, 'ask');

	controller.selectTask(a.id);
	assert.equal(controller.runMode, 'plan');
	assert.equal(controller.effort, 'high');
	assert.equal(controller.thinking, true);
	assert.ok(sent.some(c => c.type === 'SetMode' && c.mode === 'plan'));
	assert.ok(sent.some(c => c.type === 'SetModelSettings'));
});

test('setEngineKind sticks on Task; CreateSession sends dsh only when selected', () => {
	const sent: BridgeCommand[] = [];
	let n = 0;
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-1',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => `id-${++n}`
	});
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	assert.equal(controller.engineKind, 'dsh');
	const a = controller.createTask('A');
	assert.equal(a.engineKind, 'dsh');
	const create = sent.find(c => c.type === 'CreateSession');
	assert.ok(create && create.type === 'CreateSession');
	if (create?.type === 'CreateSession') {
		assert.equal(create.engineKind, 'dsh');
	}
	controller.acceptNewSession('sess-a', a.id, 'ws-1');
	assert.equal(controller.setEngineKind('fast'), true);
	assert.equal(controller.engineKind, 'fast');
	assert.ok(!sent.some(c => c.type === 'SetEngineKind'));
	assert.ok(sent.some(c => c.type === 'SetEngine' && c.kind === 'fast'));
});

test('SetEngineKind reject or stale success does not clobber a later pick', () => {
	const sent: BridgeCommand[] = [];
	let n = 0;
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-1',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => `id-${++n}`
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id, 'ws-1');
	assert.equal(controller.engineKind, 'fast');
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	assert.equal(controller.engineKind, 'dsh');
	assert.equal(controller.setEngineKind('fast'), true);
	assert.equal(controller.engineKind, 'fast');
	controller.handleEvent({
		type: 'command_result',
		name: 'SetEngineKind',
		message: 'dsh',
		status: 'success',
		sessionId: 'sess-a'
	});
	assert.equal(controller.engineKind, 'fast');
	assert.equal(controller.getActiveTask()?.engineKind, 'fast');

	assert.equal(controller.setEngineKind('dsh'), true);
	controller.handleEvent({
		type: 'command_result',
		name: 'SetEngineKind',
		message: 'busy',
		status: 'rejected',
		sessionId: 'sess-a'
	});
	assert.equal(controller.engineKind, 'dsh');
	assert.equal(controller.getActiveTask()?.engineKind, 'dsh');
});

test('setEngineKind dsh survives sessions_list that still reports the bound fast kind', () => {
	let n = 0;
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-1',
		send: () => true,
		createId: () => `id-${++n}`
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id, 'ws-1');
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	assert.equal(controller.engineKind, 'dsh');

	controller.hydrateFromSessionsList([
		{
			id: 'sess-a',
			title: 'A',
			lastModified: '2026-09-16T00:00:00.000Z',
			isCurrent: true,
			engineKind: 'fast',
			messageCount: 0
		}
	]);
	assert.equal(controller.engineKind, 'dsh', 'inventory must not revert the Composer pick');
	assert.equal(controller.getActiveTask()?.engineKind, 'dsh');
});

test('setEngineKind dsh survives sessions_list before Attach', () => {
	let n = 0;
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-1',
		send: () => true,
		createId: () => `id-${++n}`
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id, 'ws-1');
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	assert.equal(controller.engineKind, 'dsh');

	controller.hydrateFromSessionsList([
		{
			id: 'sess-a',
			title: 'A',
			lastModified: '2026-09-16T00:00:00.000Z',
			isCurrent: true,
			messageCount: 0
		}
	]);
	assert.equal(controller.engineKind, 'dsh', 'unattached pick must survive omitted inventory kind');
	assert.equal(controller.getActiveTask()?.engineKind, 'dsh');
});

test('setEngineKind applies when expectedTaskId is the pane task even if focus lags', () => {
	let n = 0;
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-1',
		send: () => true,
		createId: () => `id-${++n}`
	});
	const a = controller.createTask('A');
	const b = controller.createTask('B');
	controller.acceptNewSession('sess-a', a.id, 'ws-1');
	controller.acceptNewSession('sess-b', b.id, 'ws-1');
	controller.selectTask(a.id);
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh', b.id), true);
	assert.equal(controller.engineKind, 'dsh');
	assert.equal(b.engineKind, 'dsh');
});

test('setEngineKind dsh without available does not send SetEngine and stays fast', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-1',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'id-1'
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id, 'ws-1');
	assert.equal(controller.setEngineKind('dsh'), false);
	assert.equal(controller.engineKind, 'fast');
	assert.ok(!sent.some(c => c.type === 'SetEngine'));
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	assert.ok(!sent.some(c => c.type === 'SetEngineKind'));
	assert.ok(sent.some(c => c.type === 'SetEngine' && c.kind === 'dsh' && c.sessionId === 'sess-a'));
});

test('rebindPickedEngine resends SetEngine for the owned dsh pick', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-1',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'id-1'
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id, 'ws-1');
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	sent.length = 0;
	controller.rebindPickedEngine();
	assert.ok(sent.some(c => c.type === 'SetEngine' && c.kind === 'dsh' && c.sessionId === 'sess-a'));
});

test('hydrateFromSessionsList cold-restores runMode and model_settings', () => {
	let n = 0;
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: () => `id-${++n}`
	});
	controller.hydrateFromSessionsList([
		{
			id: 'sess-sticky',
			title: 'Sticky',
			lastModified: '2026-07-15T12:00:00.000Z',
			messageCount: 2,
			isCurrent: true,
			runMode: 'plan',
			engineKind: 'dsh',
			modelSettings: {
				platform: 'openrouter',
				model: 'claude-sonnet-4',
				effort: 'high',
				thinking: true
			}
		}
	]);
	assert.equal(controller.runMode, 'plan');
	assert.equal(controller.engineKind, 'dsh');
	assert.equal(controller.effort, 'high');
	assert.equal(controller.thinking, true);
	assert.equal(controller.model, 'openrouter/claude-sonnet-4');
	const task = controller.getActiveTask();
	assert.equal(task?.runMode, 'plan');
	assert.equal(task?.engineKind, 'dsh');
	assert.equal(task?.effort, 'high');
	assert.equal(task?.thinking, true);
});

test('hydrate omit effort/thinking keeps prior Task chrome', () => {
	const sent: BridgeCommand[] = [];
	let n = 0;
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-1',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => `id-${++n}`
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id, 'ws-1');
	assert.equal(controller.setModelSettings({
		platform: 'openrouter',
		model: 'claude-sonnet-4',
		effort: 'high',
		thinking: false
	}), true);
	assert.equal(controller.effort, 'high');
	assert.equal(controller.thinking, false);

	// Engine JSON omits None fields — re-hydrate must not wipe Off / effort.
	controller.hydrateFromSessionsList([
		{
			id: 'sess-a',
			title: 'A',
			lastModified: '2026-07-15T12:00:00.000Z',
			messageCount: 1,
			isCurrent: true,
			runMode: 'plan',
			modelSettings: {
				platform: 'openrouter',
				model: 'claude-sonnet-4'
			}
		}
	]);
	assert.equal(controller.getActiveTask()?.effort, 'high');
	assert.equal(controller.getActiveTask()?.thinking, false);
	controller.selectTask(a.id);
	assert.equal(controller.effort, 'high');
	assert.equal(controller.thinking, false);
	assert.equal(controller.runMode, 'plan');
});

test('selectTask to Off task does not emit SetModelSettings(true) from composer materialize path', () => {
	// Regression: DialogueComposer no longer persists thinking:true on mount.
	// Controller chrome for Off must survive focus switch without a sticky overwrite.
	const sent: BridgeCommand[] = [];
	let n = 0;
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-1',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => `id-${++n}`
	});
	const onTask = controller.createTask('On');
	controller.acceptNewSession('sess-on', onTask.id, 'ws-1');
	controller.setModelSettings({
		platform: 'openrouter',
		model: 'claude-sonnet-4',
		effort: 'medium',
		thinking: true
	});
	const offTask = controller.createTask('Off');
	controller.acceptNewSession('sess-off', offTask.id, 'ws-1');
	controller.setModelSettings({
		platform: 'openrouter',
		model: 'claude-sonnet-4',
		effort: 'low',
		thinking: false
	});
	sent.length = 0;
	controller.selectTask(offTask.id);
	assert.equal(controller.thinking, false);
	assert.equal(
		sent.filter(c => c.type === 'SetModelSettings' && c.thinking === true).length,
		0,
		'must not rewrite Off → On on selectTask'
	);
});

test('SubmitUserMessage includes sticky effort/thinking', () => {
	const sent: BridgeCommand[] = [];
	let n = 0;
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-1',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => `id-${++n}`
	});
	const task = controller.createTask('A');
	controller.acceptNewSession('sess-a', task.id, 'ws-1');
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});
	controller.handleEvent({
		type: 'session_restored',
		sessionId: 'sess-a',
		turns: []
	});
	assert.equal(controller.setModelSettings({
		platform: 'openrouter',
		model: 'claude-sonnet-4',
		effort: 'xhigh',
		thinking: true
	}), true);
	sent.length = 0;
	assert.equal(controller.sendMessage('hello'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit?.type === 'SubmitUserMessage');
	if (submit?.type === 'SubmitUserMessage') {
		assert.equal(submit.effort, 'xhigh');
		assert.equal(submit.thinking, true);
	}
});

test('SubmitUserMessage defaults thinking=true when catalog supportsThinking and sticky unset', () => {
	const sent: BridgeCommand[] = [];
	let n = 0;
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-1',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => `id-${++n}`
	});
	const task = controller.createTask('A');
	controller.acceptNewSession('sess-a', task.id, 'ws-1');
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});
	controller.handleEvent({
		type: 'session_restored',
		sessionId: 'sess-a',
		turns: []
	});
	assert.equal(controller.requestModelList(), true);
	controller.handleEvent({
		type: 'command_result',
		name: 'model',
		message:
			'Current model: thinky\n\n* thinky | thinking=1 efforts=low,medium,high default=medium\n\nUsage: /model <name|alias>',
		status: 'success',
		sessionId: 'sess-a'
	});
	assert.equal(controller.thinking, undefined);
	assert.equal(controller.modelCatalog[0]?.supportsThinking, true);
	assert.equal(controller.model, 'thinky');
	sent.length = 0;
	assert.equal(controller.sendMessage('hello'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit?.type === 'SubmitUserMessage');
	if (submit?.type === 'SubmitUserMessage') {
		assert.equal(submit.thinking, true);
	}
});
