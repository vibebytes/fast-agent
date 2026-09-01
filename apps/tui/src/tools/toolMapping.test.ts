import test from 'node:test';
import assert from 'node:assert/strict';
import {globMatches, mapToolRun, resolveRenderer} from './toolMapping.js';

test('resolveRenderer picks shell and file renderers', () => {
	assert.equal(resolveRenderer('shell', {}), 'shell');
	assert.equal(resolveRenderer('read_file', {language: 'python'}), 'file');
	assert.equal(resolveRenderer('list_dir', {}), 'dense');
	assert.equal(resolveRenderer('skill_view', {}), 'dense', 'SkillSlash activation is a one-line dense row');
});

test('mapToolRun builds display model', () => {
	const model = mapToolRun({
		id: 't1',
		tool: 'shell',
		args: {command: 'ls'},
		output: [{stream: 'stdout', text: 'app.js'}],
		status: 'success',
		fields: {exit: '0', duration: '10ms'}
	});
	assert.equal(model.renderer, 'shell');
	assert.equal(model.command, 'ls');
	assert.equal(model.exitCode, '0');
});

test('mapToolRun maps user denied tool results to denied status', () => {
	const model = mapToolRun({
		id: 't1',
		tool: 'write_file',
		args: {path: 'index.html'},
		output: [{stream: 'stderr', text: 'User denied execution'}],
		status: 'failed',
		fields: {}
	});

	assert.equal(model.status, 'denied');
	assert.equal(model.summary, 'User denied execution');
});

test('mapToolRun sanitizes carriage-return, backspace and ANSI escapes', () => {
	const model = mapToolRun({
		id: 't2',
		tool: 'shell',
		args: {command: 'echo test'},
		output: [{
			stream: 'stdout',
			text: '\u001b[31mERR\u001b[0m progress 10%\rprogress 90%\nabc\b\bX'
		}],
		status: 'success',
		fields: {}
	});

	assert.equal(model.output[0]?.text, 'progress 90%\naX');
	assert.equal(model.summary, 'progress 90% aX');
});

test('mapToolRun cleans <tool_result> tags and prefixes', () => {
	const model = mapToolRun({
		id: 't3',
		tool: 'shell',
		args: {command: 'docker ps'},
		output: [{
			stream: 'stdout',
			text: '<tool_result name="shell" success="true">\noutput: /usr/local/bin/docker\n/usr/local/bin/docker-compose\nsummary: /usr/local/bin/docker\n</tool_result>'
		}],
		status: 'success',
		fields: {}
	});

	assert.equal(model.output[0]?.text, '/usr/local/bin/docker\n/usr/local/bin/docker-compose');
	assert.equal(model.summary, '/usr/local/bin/docker /usr/local/bin/docker-compose');
});

test('mapToolRun glob summary carries the total count; matches exposed for the list body', () => {
	const model = mapToolRun({
		id: 'g1',
		tool: 'glob',
		args: {pattern: '**/*.tsx', path: '.'},
		output: [{
			stream: 'stdout',
			text: 'src/App.tsx\nsrc/pages/Login.tsx\nsrc/pages/Register.tsx\nsrc/components/Card.tsx\nsrc/components/Badge.tsx'
		}],
		status: 'success',
		fields: {}
	});

	assert.equal(model.summary, '共 5 个文件');
	assert.deepEqual(globMatches(model), [
		'src/App.tsx',
		'src/pages/Login.tsx',
		'src/pages/Register.tsx',
		'src/components/Card.tsx',
		'src/components/Badge.tsx'
	]);
});

test('mapToolRun glob single match and no-match keep the plain first-line summary', () => {
	const single = mapToolRun({
		id: 'g3',
		tool: 'glob',
		args: {pattern: '**/Layout.tsx'},
		output: [{stream: 'stdout', text: 'frontend/src/components/Layout.tsx'}],
		status: 'success',
		fields: {}
	});
	assert.equal(single.summary, 'frontend/src/components/Layout.tsx');
	assert.deepEqual(globMatches(single), [], 'single match renders inline, no list body');

	const none = mapToolRun({
		id: 'g4',
		tool: 'glob',
		args: {pattern: '**/*.vue'},
		output: [{stream: 'stdout', text: 'no files match **/*.vue'}],
		status: 'success',
		fields: {}
	});
	assert.equal(none.summary, 'no files match **/*.vue');
	assert.deepEqual(globMatches(none), []);
});

test('define_agent renders dense with agent name and config summary', () => {
	// The engine flattens array args to JSON strings (parseToolArgs.noSpaces).
	const model = mapToolRun({
		id: 'd1',
		tool: 'define_agent',
		args: {
			name: '风控员',
			tools: '["read_file","grep"]',
			system_prompt: '你是严格的风控专员，只输出风险清单。',
			max_turns: '8'
		},
		output: [{stream: 'stdout', text: "Agent '风控员' defined (agentId=019f387c-fddc-7b84). Sub-agents: "}],
		status: 'success',
		fields: {}
	});

	assert.equal(model.renderer, 'dense', 'define_agent must render as a one-line dense row, not a bare raw header');
	assert.match(model.summary, /已定义/);
	assert.match(model.summary, /read_file, grep/);
	assert.match(model.summary, /8 轮/);
	assert.ok(!model.summary.includes('agentId='), 'raw agentId is noise on the card');
});

test('define_agent without tools/max_turns still summarizes cleanly', () => {
	const model = mapToolRun({
		id: 'd2',
		tool: 'define_agent',
		args: {name: 'reviewer'},
		output: [{stream: 'stdout', text: "Agent 'reviewer' defined (agentId=abc). Sub-agents: "}],
		status: 'success',
		fields: {}
	});
	assert.equal(model.summary, '已定义');
});

test('define_agent failure keeps the engine error as summary', () => {
	const model = mapToolRun({
		id: 'd3',
		tool: 'define_agent',
		args: {name: 'reviewer'},
		output: [{stream: 'stdout', text: "Agent name(s) already exist: reviewer. Use update_agent to modify, or delete_agent first."}],
		status: 'failed',
		fields: {}
	});
	assert.match(model.summary, /already exist/);
});

test('update_agent and delete_agent render dense with the agent name inline', () => {
	const updated = mapToolRun({
		id: 'u1', tool: 'update_agent', args: {name: '风控员', max_turns: '16'},
		output: [], status: 'success', fields: {}
	});
	assert.equal(updated.renderer, 'dense');

	const deleted = mapToolRun({
		id: 'x1', tool: 'delete_agent', args: {name: '风控员'},
		output: [], status: 'success', fields: {}
	});
	assert.equal(deleted.renderer, 'dense');
});

test('mapToolRun cleans failed tool_result tags and error prefixes', () => {
	const model = mapToolRun({
		id: 't4',
		tool: 'shell',
		args: {command: 'nonexistent'},
		output: [{
			stream: 'stdout',
			text: '<tool_result name="shell" success="false" kind="failed">\nerror: exit=127\n</tool_result>'
		}],
		status: 'failed',
		fields: {}
	});

	assert.equal(model.output[0]?.text, 'exit=127');
	assert.equal(model.summary, 'exit=127');
});
