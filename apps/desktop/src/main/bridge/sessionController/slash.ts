/** SessionController tests — slash / skill catalog. Loaded by SessionController.test.ts. */
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

test('slash catalog from commands_available; skills list silent; skill slash forwards to Bridge', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		discoverHostSkills: () => [
			{name: 'host-skill', description: 'From disk', available: true, badge: 'personal'}
		]
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	// Attach must not prefetch /skills (switch/create hot path). Composer pulls on menu open.
	assert.equal(
		sent.some(c => c.type === 'command' && c.name === 'skills'),
		false,
		'Attached must not silent-/skills'
	);
	sent.length = 0;
	assert.equal(controller.requestSlashCatalog(), true);
	assert.equal(controller.slashCatalogHydrated, true);
	assert.equal(controller.slashCatalog[0]?.name, 'host-skill');
	assert.ok(
		sent.some(
			c =>
				c.type === 'command' &&
				c.name === 'skills' &&
				c.args === '' &&
				c.sessionId === 'sess'
		),
		'silent /skills must stamp sessionId'
	);
	sent.length = 0;
	// In-flight silent request is not stacked.
	assert.equal(controller.requestSlashCatalog(), true);
	assert.equal(sent.length, 0);

	controller.handleEvent({
		type: 'commands_available',
		commands: [
			{
				name: 'explain-code',
				description: 'Explain',
				usage: '/explain-code',
				available: true,
				badge: 'personal'
			}
		]
	});
	// Bridge merges with Host disk skills (Bridge wins on name collision).
	assert.equal(controller.slashCatalog.length, 2);
	assert.ok(controller.slashCatalog.some(e => e.name === 'host-skill'));
	const explained = controller.slashCatalog.find(e => e.name === 'explain-code');
	assert.equal(explained?.badge, 'personal');
	assert.equal(controller.slashCatalogHydrated, true);

	controller.handleEvent({
		type: 'command_result',
		name: 'skills',
		message: 'Skills (1)\n──\n  explain-code',
		status: 'success'
	});
	assert.equal(controller.getActiveTask()?.transcript.entries.length, 0);

	assert.equal(controller.sendMessage('/explain-code look at this'), true);
	const skillCmd = sent.find(c => c.type === 'command' && c.name === 'explain-code');
	assert.ok(skillCmd, 'skill command must be sent');
	assertSkillCommandPinned(skillCmd, 'sess');
	assert.equal(skillCmd.args, 'look at this');
});

test('skill slash without attached session surfaces blocker notice (not silent)', () => {
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		send: () => true,
		createId: () => 'task-pending'
	});
	controller.createTask('Pending');
	assert.equal(controller.sendMessage('/explain-code'), false);
	assert.equal(controller.consumeHelpNotice(), 'errors.send.session_starting');
});

test('intentional /skills is not swallowed by silent catalog refresh', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});

	assert.equal(controller.requestSlashCatalog(), true);
	assert.equal(controller.sendMessage('/skills'), true);

	// Silent refresh result — dropped from transcript.
	controller.handleEvent({
		type: 'command_result',
		name: 'skills',
		message: 'Skills (silent)\n──\n  a',
		status: 'success'
	});
	assert.equal(controller.getActiveTask()?.transcript.entries.length, 0);

	// User /skills result projects into transcript.
	const afterUser = controller.handleEvent({
		type: 'command_result',
		name: 'skills',
		message: 'Skills (1)\n──\n  explain-code',
		status: 'success'
	});
	assert.ok((afterUser?.transcript.entries.length ?? 0) > 0);
});

test('requestSlashCatalog does not mark silent when send fails', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => false
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});

	assert.equal(controller.requestSlashCatalog(), false);
	// Failed silent refresh must not flip later dumps into transcript.
	controller.handleEvent({
		type: 'command_result',
		name: 'skills',
		message: 'Skills (1)\n──\n  explain-code',
		status: 'success'
	});
	assert.equal(controller.getActiveTask()?.transcript.entries.length, 0);
});

test('unsolicited skills dump after SetEngine stays out of transcript', () => {
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-1',
		send: () => true,
		createId: () => 'id-1'
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id, 'ws-1');
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	controller.handleEvent({
		type: 'command_result',
		name: 'SetEngineKind',
		message: 'dsh',
		status: 'success',
		sessionId: 'sess'
	});
	controller.handleEvent({
		type: 'command_result',
		name: 'skills',
		message:
			'Skills (69)\n────────────────────────────────────────\n  research\n\nRun with /<skill-name> [args] (activates skill, then continues in this session).',
		status: 'success',
		sessionId: 'sess'
	});
	assert.equal(controller.getActiveTask()?.transcript.entries.length, 0);
});

test('silent /skills Unknown command does not leak into next send notice', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		discoverHostSkills: () => [
			{name: 'code-review', description: 'Review', available: true, badge: 'personal'}
		]
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent({
		type: 'command_result',
		name: 'skills',
		message: 'Unknown command: /skills',
		status: 'error'
	});
	assert.equal(controller.consumeHelpNotice(), null);

	assert.equal(controller.sendMessage('/code-review look'), true);
	assert.equal(controller.consumeHelpNotice(), null);
});
test('skill slash command_result error paints into transcript', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent({
		type: 'command_result',
		name: 'code-review',
		message: 'Unknown command: /code-review (Skill not found)',
		status: 'error'
	});
	const entries = controller.getActiveTask()?.transcript.entries ?? [];
	assert.equal(entries.length, 1);
	assert.equal(entries[0]?.status, 'error');
	assert.match(entries[0]?.text ?? '', /code-review/);
});

test('empty commands_available keeps host-seeded slash catalog', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		discoverHostSkills: () => [
			{name: 'code-review', description: 'Review', available: true, badge: 'personal'}
		]
	});
	assert.equal(controller.seedHostSlashCatalog(), true);
	assert.equal(controller.slashCatalog[0]?.name, 'code-review');
	controller.handleEvent({type: 'commands_available', commands: []});
	assert.equal(controller.slashCatalogHydrated, true);
	assert.equal(controller.slashCatalog[0]?.name, 'code-review');
});

test('empty commands_available on dsh keeps catalog for skill.list', () => {
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
		createId: () => `id-${++n}`,
		discoverHostSkills: () => [
			{name: 'code-review', description: 'Review', available: true, badge: 'personal'}
		]
	});
	assert.equal(controller.seedHostSlashCatalog(), true);
	const task = controller.createTask('A');
	controller.acceptNewSession('sess-dsh', task.id, 'ws-1');
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	controller.handleEvent({type: 'commands_available', commands: []});
	assert.equal(controller.slashCatalogHydrated, true);
	assert.equal(controller.slashCatalog[0]?.name, 'code-review');
});

test('dsh skill slash is SubmitUserMessage text, not Fast command', () => {
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
		createId: () => `id-${++n}`,
		discoverHostSkills: () => [
			{name: 'code-review', description: 'Review', available: true, badge: 'personal'}
		]
	});
	const task = controller.createTask('A');
	controller.acceptNewSession('sess-dsh', task.id, 'ws-1');
	controller.handleEvent({type: 'Attached', sessionId: 'sess-dsh', clientId: 'cli'});
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	assert.equal(controller.sendMessage('/code-review look'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.equal(submit && 'text' in submit ? submit.text : undefined, '/code-review look');
	assert.ok(!sent.some(c => c.type === 'command' && c.name === 'code-review'));
});

test('dsh /model and /mode do not send Fast command', () => {
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
	controller.acceptNewSession('sess-dsh', task.id, 'ws-1');
	controller.handleEvent({type: 'Attached', sessionId: 'sess-dsh', clientId: 'cli'});
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	assert.equal(controller.sendMessage('/model deepseek-v4-flash'), true);
	assert.ok(!sent.some(c => c.type === 'command' && c.name === 'model'));
	assert.ok(!sent.some(c => c.type === 'SubmitUserMessage'));
	assert.equal(controller.sendMessage('/mode agent'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.equal(submit && 'text' in submit ? submit.text : undefined, '/mode agent');
	assert.ok(!sent.some(c => c.type === 'command' && c.name === 'mode'));
	assert.ok(!sent.some(c => c.type === 'SetMode'));
});

test('seedHostSlashCatalog backfills when Bridge flag set but catalog empty', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		discoverHostSkills: () => [
			{name: 'research', description: 'Research', available: true, badge: 'personal'}
		]
	});
	controller.handleEvent({
		type: 'commands_available',
		commands: [{name: 'plan', description: 'Plan', usage: '', available: true, badge: 'builtin'}]
	});
	assert.ok(controller.slashCatalog.some(e => e.name === 'plan'));
	// Simulate wipe while bridgeSlashCatalog remains true — Host must still backfill.
	controller.slashCatalog = [];
	assert.equal(controller.seedHostSlashCatalog(), true);
	assert.equal(controller.slashCatalog[0]?.name, 'research');
});

test('commands_available merges host disk skills; Bridge wins on name collision', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		discoverHostSkills: () => [
			{name: 'research', description: 'Host research', available: true, badge: 'personal'},
			{name: 'to-spec', description: 'Host to-spec', available: true, badge: 'personal'},
			{name: 'plan', description: 'Host plan stale', available: true, badge: 'personal'}
		]
	});
	controller.handleEvent({
		type: 'commands_available',
		commands: [
			{name: 'plan', description: 'Builtin plan', usage: '', available: true, badge: 'builtin'},
			{name: 'to-spec', description: 'Builtin to-spec', usage: '', available: true, badge: 'builtin'},
			{name: 'brainstorm', description: 'Ideas', usage: '', available: true, badge: 'builtin'}
		]
	});
	const names = controller.slashCatalog.map(e => e.name).sort();
	assert.deepEqual(names, ['brainstorm', 'plan', 'research', 'to-spec']);
	assert.equal(controller.slashCatalog.find(e => e.name === 'plan')?.description, 'Builtin plan');
	assert.equal(controller.slashCatalog.find(e => e.name === 'plan')?.badge, 'builtin');
	assert.equal(controller.slashCatalog.find(e => e.name === 'to-spec')?.badge, 'builtin');
	assert.equal(controller.slashCatalog.find(e => e.name === 'research')?.badge, 'personal');
});

test('commands_available normalizes legacy Engine badge labels to ids', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		discoverHostSkills: () => [
			{name: 'research', description: 'Host research', available: true, badge: '个人'}
		]
	});
	controller.handleEvent({
		type: 'commands_available',
		commands: [
			{name: 'plan', description: 'Builtin plan', usage: '', available: true, badge: '内置'}
		]
	});
	assert.equal(controller.slashCatalog.find(e => e.name === 'plan')?.badge, 'builtin');
	assert.equal(controller.slashCatalog.find(e => e.name === 'research')?.badge, 'personal');
});

test('Host coding product names are not merged as personal when Bridge omits them', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		discoverHostSkills: () => [
			{name: 'implement', description: 'Host implement', available: true, badge: 'personal'},
			{name: 'grilling', description: 'Host grilling', available: true, badge: 'personal'}
		]
	});
	controller.handleEvent({
		type: 'commands_available',
		commands: [{name: 'plan', description: 'Plan', usage: '', available: true, badge: 'builtin'}]
	});
	assert.ok(!controller.slashCatalog.some(e => e.name === 'implement'));
	assert.ok(controller.slashCatalog.some(e => e.name === 'grilling'));
});

test('Unknown command for host-known skill adds SkillSlash rebuild hint', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		discoverHostSkills: () => [
			{
				name: 'improve-codebase-architecture',
				description: 'Arch',
				available: true,
				badge: 'personal'
			}
		]
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent({
		type: 'command_result',
		name: 'improve-codebase-architecture',
		message: 'Unknown command: /improve-codebase-architecture',
		status: 'error'
	});
	const text = controller.getActiveTask()?.transcript.entries[0]?.text ?? '';
	assert.match(text, /Unknown command: \/improve-codebase-architecture/);
	assert.match(text, /SkillSlash/);
});
test('busy turn sends skill slash as Bridge command (Session queues skillSlash)', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})()
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess-busy', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-busy', clientId: 'cli'});
	controller.handleEvent({
		type: 'commands_available',
		commands: [{name: 'explain-code', description: 'Explain', usage: '/explain-code', available: true}]
	});
	controller.handleEvent(withSid('sess-busy', {type: 'turn_started', turnId: 't1', text: 'first'}));
	sent.length = 0;
	assert.equal(controller.sendMessage('/explain-code look'), true);
	assert.equal(controller.getActiveTask()?.queue.length, 0);
	assert.ok(sent.some(c => c.type === 'command' && c.name === 'explain-code'));
	assert.ok(!sent.some(c => c.type === 'SubmitUserMessage'));
});

test('skill command_result error clears titleGenRequested so pending can retry', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('New task');
	assert.equal(task.autoTitlePending, true);
	controller.acceptNewSession('sess-err', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-err', clientId: 'cli'});
	controller.handleEvent({
		type: 'commands_available',
		commands: [{name: 'explain-code', description: 'Explain', usage: '/explain-code', available: true}]
	});
	assert.equal(controller.sendMessage('/explain-code'), true);
	controller.handleEvent({
		type: 'command_result',
		name: 'explain-code',
		message: "Unknown command: /explain-code (Skill 'explain-code' not found)",
		status: 'error',
		sessionId: 'sess-err'
	});
	assert.equal(controller.getActiveTask()?.autoTitlePending, true);
	// Spurious input_accepted must not clear pending after error cleared sticky opt-in.
	controller.handleEvent({
		type: 'input_accepted',
		sessionId: 'sess-err',
		clientMessageId: 'x',
		turnId: 'x'
	});
	assert.equal(controller.getActiveTask()?.autoTitlePending, true);
	sent.length = 0;
	assert.equal(controller.sendMessage('retry as normal message'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit?.type === 'SubmitUserMessage');
	if (submit?.type === 'SubmitUserMessage') {
		assert.equal(submit.generateTitle, true);
	}
});

test('available:false catalog skill is not routed as slash', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess-na', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-na', clientId: 'cli'});
	controller.handleEvent({
		type: 'commands_available',
		commands: [{name: 'hidden-skill', description: 'nope', usage: '/hidden-skill', available: false}]
	});
	sent.length = 0;
	assert.equal(controller.sendMessage('/hidden-skill'), true);
	assert.ok(sent.some(c => c.type === 'SubmitUserMessage'));
	assert.ok(!sent.some(c => c.type === 'command' && c.name === 'hidden-skill'));
});

test('unknown /xxx is SubmitUserMessage not Bridge command', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('New task');
	controller.acceptNewSession('sess-u', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-u', clientId: 'cli'});
	sent.length = 0;
	assert.equal(controller.sendMessage('/not-a-real-skill please'), true);
	assert.ok(sent.some(c => c.type === 'SubmitUserMessage'));
	assert.ok(!sent.some(c => c.type === 'command' && c.name === 'not-a-real-skill'));
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	if (submit?.type === 'SubmitUserMessage') {
		assert.equal(submit.generateTitle, true);
		assert.equal(submit.text, '/not-a-real-skill please');
	}
});

test('skill slash with autoTitlePending sends command.generateTitle; input_accepted clears pending', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('New task');
	assert.equal(task.autoTitlePending, true);
	controller.acceptNewSession('sess-sk', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-sk', clientId: 'cli'});
	controller.handleEvent({
		type: 'commands_available',
		commands: [{name: 'explain-code', description: 'Explain', usage: '/explain-code', available: true}]
	});
	sent.length = 0;
	assert.equal(controller.sendMessage('/explain-code look at auth'), true);
	const skillCmd = sent.find(c => c.type === 'command' && c.name === 'explain-code');
	assert.ok(skillCmd?.type === 'command');
	if (skillCmd?.type === 'command') {
		assert.equal(skillCmd.generateTitle, true);
		assert.equal(skillCmd.args, 'look at auth');
	}
	assert.equal(controller.getActiveTask()?.autoTitlePending, true);
	controller.handleEvent({
		type: 'input_accepted',
		sessionId: 'sess-sk',
		clientMessageId: 'x',
		turnId: 'x'
	});
	assert.equal(controller.getActiveTask()?.autoTitlePending, false);
});

test('skill slash without generateTitle does not clear autoTitlePending on input_accepted', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('New task');
	controller.acceptNewSession('sess-keep', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-keep', clientId: 'cli'});
	// First: /skills (fixed command, no generateTitle)
	sent.length = 0;
	assert.equal(controller.sendMessage('/skills'), true);
	controller.handleEvent({
		type: 'input_accepted',
		sessionId: 'sess-keep',
		clientMessageId: 'x',
		turnId: 'x'
	});
	// /skills does not emit input_accepted in practice, but if it did pending must stay.
	assert.equal(controller.getActiveTask()?.autoTitlePending, true);
	sent.length = 0;
	assert.equal(controller.sendMessage('real first message'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit?.type === 'SubmitUserMessage');
	if (submit?.type === 'SubmitUserMessage') {
		assert.equal(submit.generateTitle, true);
	}
});
