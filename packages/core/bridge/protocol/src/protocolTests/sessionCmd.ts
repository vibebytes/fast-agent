/** protocol.test — sessionCmd. Loaded by protocol.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeEventSchema, bridgeCommandSchema, isLiveChrome, parseBridgeCommand, pickIdList, wireIdList} from '../protocol.js';

test('bridgeEventSchema accepts commands_available with capability metadata', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'commands_available',
		commands: [{
			name: 'run',
			description: 'Execute an agent task',
			usage: '/run <agent> <input>',
			available: false,
			availability: 'capability_unavailable',
			capability: 'clusterTaskExecution'
		}]
	});

	assert.equal(parsed.type, 'commands_available');
	assert.equal(parsed.commands[0]?.availability, 'capability_unavailable');
});

test('bridgeEventSchema accepts commands_available badge', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'commands_available',
		commands: [{
			name: 'explain-code',
			description: 'Explain',
			usage: '/explain-code',
			available: true,
			availability: 'ready',
			badge: '个人'
		}]
	});
	assert.equal(parsed.type, 'commands_available');
	if (parsed.type === 'commands_available') {
		assert.equal(parsed.commands[0]?.badge, '个人');
	}
});

test('bridgeEventSchema tolerates legacy commands_available null capability and compact availability', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'commands_available',
		commands: [{
			name: 'model',
			description: 'Show or switch model',
			usage: '/model [name]',
			available: true,
			availability: 'capabilityunavailable',
			capability: null
		}]
	});

	assert.equal(parsed.type, 'commands_available');
	assert.equal(parsed.commands[0]?.availability, 'capability_unavailable');
	assert.equal(parsed.commands[0]?.capability, undefined);
});

test('RerunRun command parses and rejects unknown fields', () => {
	const cmd = bridgeCommandSchema.parse({
		type: 'RerunRun',
		sessionId: 's1',
		runId: 'run_01JABC'
	});
	assert.equal(cmd.type, 'RerunRun');
	if (cmd.type === 'RerunRun') {
		assert.equal(cmd.sessionId, 's1');
		assert.equal(cmd.runId, 'run_01JABC');
	}
	assert.throws(() => bridgeCommandSchema.parse({type: 'RerunRun', sessionId: 's1'}));
});

test('CONTRACT: Bridge command accepts sessionId for SkillSlash multi-Attach pin', () => {
	const pinned = parseBridgeCommand({
		type: 'command',
		name: 'explain-code',
		args: 'look',
		sessionId: 'sess-task'
	});
	assert.equal(pinned.type, 'command');
	if (pinned.type === 'command') {
		assert.equal(pinned.sessionId, 'sess-task');
	}
	const bare = parseBridgeCommand({type: 'command', name: 'skills', args: ''});
	assert.equal(bare.type, 'command');
	if (bare.type === 'command') {
		assert.equal(bare.sessionId, undefined);
	}
});

test('command accepts optional generateTitle (aligned with SubmitUserMessage)', () => {
	const omitted = parseBridgeCommand({type: 'command', name: 'explain-code', args: '', sessionId: 's'});
	assert.equal(omitted.type, 'command');
	if (omitted.type === 'command') {
		assert.equal(omitted.generateTitle, undefined);
	}
	const on = parseBridgeCommand({
		type: 'command',
		name: 'explain-code',
		args: 'look',
		sessionId: 's',
		generateTitle: true
	});
	assert.equal(on.type, 'command');
	if (on.type === 'command') {
		assert.equal(on.generateTitle, true);
	}
});

test('SubmitUserMessage accepts optional generateTitle (omit / false / true)', () => {
	const base = {
		type: 'SubmitUserMessage' as const,
		sessionId: 's1',
		clientMessageId: 'c1',
		text: 'fix auth login'
	};
	const omitted = bridgeCommandSchema.parse(base);
	assert.equal(omitted.type, 'SubmitUserMessage');
	if (omitted.type === 'SubmitUserMessage') {
		assert.equal(omitted.generateTitle, undefined);
	}

	const off = bridgeCommandSchema.parse({...base, generateTitle: false});
	assert.equal(off.type, 'SubmitUserMessage');
	if (off.type === 'SubmitUserMessage') {
		assert.equal(off.generateTitle, false);
	}

	const on = bridgeCommandSchema.parse({...base, generateTitle: true});
	assert.equal(on.type, 'SubmitUserMessage');
	if (on.type === 'SubmitUserMessage') {
		assert.equal(on.generateTitle, true);
	}
});

test('SubmitUserMessage accepts optional mode', () => {
	const base = {
		type: 'SubmitUserMessage' as const,
		sessionId: 's1',
		clientMessageId: 'c1',
		text: 'hello'
	};
	const omitted = bridgeCommandSchema.parse(base);
	assert.equal(omitted.type, 'SubmitUserMessage');
	if (omitted.type === 'SubmitUserMessage') {
		assert.equal(omitted.mode, undefined);
	}
	const withMode = bridgeCommandSchema.parse({...base, mode: 'plan'});
	assert.equal(withMode.type, 'SubmitUserMessage');
	if (withMode.type === 'SubmitUserMessage') {
		assert.equal(withMode.mode, 'plan');
	}
});

test('SubmitUserMessage images are optional; EngineCall/SteerRun/QueueMessage decode', () => {
	const submit = bridgeCommandSchema.parse({
		type: 'SubmitUserMessage',
		sessionId: 's1',
		clientMessageId: 'c1',
		text: 'hi'
	});
	assert.equal(submit.type, 'SubmitUserMessage');
	if (submit.type === 'SubmitUserMessage') {
		assert.equal(submit.images, undefined);
	}
	assert.equal(
		bridgeCommandSchema.parse({type: 'SteerRun', sessionId: 's1', text: 'nudge'}).type,
		'SteerRun'
	);
	assert.equal(
		bridgeCommandSchema.parse({type: 'QueueMessage', sessionId: 's1', itemId: 'm1', action: 'remove'}).type,
		'QueueMessage'
	);
	assert.equal(
		bridgeCommandSchema.parse({type: 'EngineCall', method: 'settings.describe', requestId: 'r1'}).type,
		'EngineCall'
	);
	assert.equal(
		bridgeCommandSchema.parse({type: 'SetEngineKind', sessionId: 's1', kind: 'dsh'}).type,
		'SetEngineKind'
	);
});
