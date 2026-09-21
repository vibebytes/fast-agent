/** SessionController tests — model / provider catalog. Loaded by SessionController.test.ts. */
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

test('model list command_result populates catalog without transcript noise', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const _bind12 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind12.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	assert.equal(controller.requestModelList(), true);
	assert.ok(sent.some(c => c.type === 'command' && c.name === 'model' && c.args === ''));
	controller.handleEvent({
		type: 'command_result',
		name: 'model',
		message: '* default\n  gpt-4o\n',
		status: 'success'
	});
	assert.equal(controller.modelCatalog.length, 2);
	assert.equal(controller.getActiveTask()?.transcript.entries.length, 0);
	assert.equal(controller.selectModel('gpt-4o'), true);
	assert.ok(sent.some(c => c.type === 'command' && c.name === 'model' && c.args === 'gpt-4o'));
});

test('provider catalog is not overwritten by yaml /model dump', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const bind = controller.createTask('T');
	controller.acceptNewSession('sess', bind.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.applyProviderCatalog([
		{
			id: 'deepseek/deepseek-v4-pro',
			display: 'DeepSeek V4 Pro',
			aliases: ['deepseek-v4-pro'],
			current: true,
			supportsThinking: true,
			supportedEfforts: ['xhigh']
		},
		{
			id: 'zhipu/glm-5.2',
			display: 'GLM-5.2',
			aliases: ['glm-5.2'],
			current: false
		}
	]);
	sent.length = 0;
	assert.equal(controller.requestModelList(), true);
	assert.ok(
		!sent.some(c => c.type === 'command' && c.name === 'model'),
		'ListProviders catalog must not re-fetch yaml /model'
	);
	controller.handleEvent({
		type: 'command_result',
		name: 'model',
		message: [
			'Current model: anthropic/claude-opus-4-5',
			'',
			'  anthropic/claude-opus-4-5',
			'  anthropic/claude-sonnet-4-5',
			'  deepseek/deepseek-v4-pro',
			'',
			'Usage: /model <name|alias>'
		].join('\n'),
		status: 'success'
	});
	assert.deepEqual(
		controller.modelCatalog.map(e => e.id),
		['deepseek/deepseek-v4-pro', 'zhipu/glm-5.2']
	);
	assert.equal(
		controller.modelCatalog.some(e => e.id.includes('claude')),
		false
	);
});

test('applyProviderCatalog snaps yaml default chrome onto a ListProviders row', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	assert.equal(controller.model, 'default');
	assert.equal(controller.modelDisplay, '');
	controller.handleEvent({
		type: 'ready',
		protocolVersion: 2,
		model: 'default',
		modelDisplay: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free'
	});
	assert.equal(controller.modelDisplay, '', 'yaml stub must not paint Composer');
	controller.applyProviderCatalog([
		{
			id: 'deepseek/deepseek-v4-flash',
			display: 'DeepSeek V4 Flash',
			aliases: ['deepseek-v4-flash'],
			current: false
		},
		{
			id: 'zhipu/glm-5.2',
			display: 'GLM-5.2',
			aliases: ['glm-5.2'],
			current: false
		}
	]);
	assert.equal(controller.model, 'deepseek/deepseek-v4-flash');
	assert.equal(controller.modelDisplay, 'DeepSeek V4 Flash');
	assert.equal(controller.modelCatalog.find(e => e.current)?.id, 'deepseek/deepseek-v4-flash');
	assert.equal(
		controller.modelCatalog.some(e => e.display.includes('nemotron')),
		false
	);
});

test('applyProviderCatalog keeps a catalog pick that is already selected', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	controller.applyProviderCatalog([
		{
			id: 'deepseek/deepseek-v4-flash',
			display: 'DeepSeek V4 Flash',
			aliases: ['deepseek-v4-flash'],
			current: false
		},
		{
			id: 'zhipu/glm-5.2',
			display: 'GLM-5.2',
			aliases: ['glm-5.2'],
			current: false
		}
	]);
	assert.equal(controller.selectModel('zhipu/glm-5.2'), true);
	controller.applyProviderCatalog([
		{
			id: 'deepseek/deepseek-v4-flash',
			display: 'DeepSeek V4 Flash',
			aliases: ['deepseek-v4-flash'],
			current: false
		},
		{
			id: 'zhipu/glm-5.2',
			display: 'GLM-5.2',
			aliases: ['glm-5.2'],
			current: false
		}
	]);
	assert.equal(controller.model, 'zhipu/glm-5.2');
	assert.equal(controller.modelDisplay, 'GLM-5.2');
});

test('ready applies Engine modelDisplay when it is a real catalog id', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	assert.equal(controller.modelDisplay, '');
	controller.handleEvent({
		type: 'ready',
		protocolVersion: 2,
		model: 'openai/gpt-5.6-luna',
		modelDisplay: 'openai/gpt-5.6-luna'
	});
	assert.equal(controller.model, 'openai/gpt-5.6-luna');
	assert.equal(controller.modelDisplay, 'openai/gpt-5.6-luna');
	const task = controller.createTask('T');
	assert.equal(
		task.modelDisplay,
		'openai/gpt-5.6-luna',
		'new tasks inherit resolved display from ready'
	);
});

test('ready with bare default alias does not paint yaml nemotron', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	controller.handleEvent({
		type: 'ready',
		protocolVersion: 2,
		model: 'default',
		modelDisplay: 'default'
	});
	assert.equal(controller.modelDisplay, '');
	assert.equal(controller.modelDisplay.toLowerCase() === 'default', false);
	assert.equal(controller.modelDisplay.includes('nemotron'), false);
});

test('healDefaultModelDisplay paints real default model name over alias stub', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	assert.equal(
		controller.healDefaultModelDisplay(
			'default',
			'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free'
		),
		false,
		'must refuse to paint the yaml default stub'
	);
	controller.createTask('T');
	assert.equal(controller.healDefaultModelDisplay('default', 'openai/gpt-5.6-luna'), true);
	assert.equal(controller.modelDisplay, 'openai/gpt-5.6-luna');
	assert.equal(controller.getActiveTask()?.modelDisplay, 'openai/gpt-5.6-luna');
	assert.equal(
		controller.healDefaultModelDisplay('default', 'default'),
		false,
		'must refuse to paint the bare alias'
	);
});

test('submit sends painted model, not the alias stub default', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'msg-1'
	});
	assert.equal(
		controller.healDefaultModelDisplay('default', 'openai/gpt-5.6-luna'),
		true
	);
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	sent.length = 0;
	assert.equal(controller.sendMessage('hello'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit);
	if (submit?.type === 'SubmitUserMessage') {
		assert.notEqual(submit.useModel, 'default');
		assert.equal(submit.useModel, 'openai/gpt-5.6-luna');
	}
});

test('submit after setRunMode still does not send useModel default', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'msg-2'
	});
	controller.healDefaultModelDisplay('default', 'openai/gpt-5.6-luna');
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	assert.equal(controller.setRunMode('plan', task.id), true);
	sent.length = 0;
	assert.equal(controller.sendMessage('plan it'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit);
	if (submit?.type === 'SubmitUserMessage') {
		assert.notEqual(submit.useModel, 'default');
		assert.equal(submit.useModel, 'openai/gpt-5.6-luna');
	}
});

test('hydrate after ready does not reinstall Default placeholder on chrome', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	assert.equal(controller.healDefaultModelDisplay('default', 'openai/gpt-5.6-luna'), true);
	const early = controller.createTask('Early');
	assert.equal(early.modelDisplay, 'openai/gpt-5.6-luna');
	controller.handleEvent({
		type: 'ready',
		protocolVersion: 2,
		model: 'default',
		modelDisplay: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free'
	});
	assert.equal(
		controller.modelDisplay,
		'openai/gpt-5.6-luna',
		'yaml stub ready must not clobber a resolved catalog label'
	);
	assert.equal(controller.getActiveTask()?.modelDisplay, 'openai/gpt-5.6-luna');
	controller.handleEvent({
		type: 'sessions_list',
		sessions: [
			{
				id: 'sess-early',
				title: 'Early',
				lastModified: new Date().toISOString(),
				messageCount: 0,
				isCurrent: true
			}
		]
	});
	assert.equal(controller.modelDisplay, 'openai/gpt-5.6-luna');
	const sibling = controller.createTask('Sibling');
	controller.selectTask(early.id);
	assert.equal(
		controller.modelDisplay,
		'openai/gpt-5.6-luna',
		'selecting a pre-ready task must not paint Default'
	);
	controller.selectTask(sibling.id);
	assert.equal(controller.modelDisplay, 'openai/gpt-5.6-luna');
});

test('ready and Attached do not pull yaml /model for catalog', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	controller.handleEvent({
		type: 'ready',
		protocolVersion: 2,
		model: 'default',
		modelDisplay: 'default'
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	assert.ok(
		!sent.some(c => c.type === 'command' && c.name === 'model'),
		'Composer catalog is ListProviders, not yaml /model'
	);
});

test('Attached skips model list when concrete default label is already painted', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	assert.equal(controller.modelDisplay, '');
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	assert.ok(
		!sent.some(c => c.type === 'command' && c.name === 'model' && c.args === ''),
		'concrete default label must not trigger a redundant /model refresh'
	);
});

test('model selection is remembered per task across selectTask', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});
	const b = controller.createTask('B');
	controller.acceptNewSession('sess-b', b.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-b', clientId: 'cli'});

	controller.selectTask(a.id);
	assert.equal(controller.requestModelList(), true);
	controller.handleEvent({
		type: 'command_result',
		name: 'model',
		message: '* default\n  gpt-4o\n  claude\n',
		status: 'success'
	});
	assert.equal(controller.selectModel('gpt-4o'), true);
	assert.equal(controller.model, 'gpt-4o');
	assert.equal(controller.getActiveTask()?.model, 'gpt-4o');

	controller.selectTask(b.id);
	assert.equal(controller.model, 'default');
	assert.equal(controller.selectModel('claude'), true);
	assert.equal(controller.getActiveTask()?.model, 'claude');

	controller.selectTask(a.id);
	assert.equal(controller.model, 'gpt-4o');
	assert.equal(controller.modelDisplay, 'gpt-4o');
	assert.equal(controller.getActiveTask()?.model, 'gpt-4o');
});
