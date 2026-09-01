import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {
	buildApprovalViewModel,
	extractCommandFromToolCall,
	extractExternalDirectories,
	formatApprovalEn,
	formatApprovalSubject,
	formatShellIntentEn,
	shellApprovalIntent
} from './approvalDetails.js';

test('extractCommandFromToolCall unwraps shell JSON and unescapes newlines', () => {
	const raw =
		'shell({"command": "cd /tmp && python3 << \'PYEOF\'\\nprint(1)\\nPYEOF"})';
	const cmd = extractCommandFromToolCall(raw);
	assert.ok(cmd.includes('cd /tmp'));
	assert.ok(cmd.includes('\n'));
	assert.ok(!cmd.includes('\\n'));
});

test('extractExternalDirectories parses gate suffix', () => {
	assert.deepEqual(
		extractExternalDirectories(`shell({...}) [external directories: /, ${homedir()}]`),
		['/', homedir()]
	);
});

test('buildApprovalViewModel external_directory prefers directories + command secondary', () => {
	const view = buildApprovalViewModel({
		tool: 'shell',
		description: 'shell({"command":"ls /"}) [external directories: /]',
		risk: 'external_directory',
		context: 'ls /'
	});
	assert.equal(view.title.kind, 'external_directory');
	assert.equal(view.riskBadge, 'external_directory');
	assert.equal(view.subjectLabel, 'directory');
	assert.equal(view.subject, '/');
	assert.equal(view.secondaryLabel, 'command');
	assert.equal(view.secondary, 'ls /');
	assert.equal(view.reason.kind, 'external_directory');
	const en = formatApprovalEn(view);
	assert.equal(en.title, 'External directory access');
	assert.equal(en.secondaryLabel, 'Command');
});

test('buildApprovalViewModel shell uses command as subject', () => {
	const view = buildApprovalViewModel({
		tool: 'shell',
		description: 'shell({"command":"npm test"})',
		risk: 'shell',
		context: 'npm test'
	});
	assert.equal(view.title.kind, 'bash');
	assert.equal(view.riskBadge, 'shell');
	assert.equal(view.subject, 'npm test');
	assert.equal(view.subjectLabel, 'command');
	assert.deepEqual(view.reason, {kind: 'shell', risk: 'arbitrary'});
	const en = formatApprovalEn(view);
	assert.equal(en.title, 'Bash command');
	assert.equal(en.subjectLabel, 'Command');
	assert.equal(en.riskLabel, 'Shell');
});

test('formatApprovalSubject parses define_agent JSON and unescapes newlines', () => {
	const jsonStr = JSON.stringify({
		name: 'explore-engine',
		description: 'Explore Scala Pekko engine',
		scope: 'session',
		model: 'deepseek',
		tools: ['read_file', 'grep'],
		system_prompt: 'You are explore agent.\\nFind friction.'
	});
	const formatted = formatApprovalSubject(jsonStr);
	assert.deepEqual(formatted.titleHint, {kind: 'subagent', name: 'explore-engine'});
	assert.ok(formatted.subject.includes('Name: explore-engine'));
	assert.ok(formatted.subject.includes('Description: Explore Scala Pekko engine'));
	assert.ok(formatted.subject.includes('Tools: read_file, grep'));
	assert.ok(formatted.subject.includes('You are explore agent.\nFind friction.'));
	assert.ok(!formatted.subject.includes('\\n'));
});

test('buildApprovalViewModel formats define_agent payload nicely', () => {
	const jsonStr = JSON.stringify({
		name: 'explore-engine',
		description: 'Explore Scala Pekko engine',
		scope: 'session',
		model: 'deepseek',
		tools: ['read_file', 'grep'],
		system_prompt: 'Line 1\\nLine 2'
	});
	const view = buildApprovalViewModel({
		tool: 'define_agent',
		description: `define_agent(${jsonStr})`,
		risk: 'external_side_effect',
		context: jsonStr
	});
	assert.deepEqual(view.title, {kind: 'subagent', name: 'explore-engine'});
	assert.equal(view.subjectLabel, 'subagent_spec');
	assert.equal(view.riskBadge, 'external_side_effect');
	assert.ok(view.subject.includes('Line 1\nLine 2'));
	const en = formatApprovalEn(view);
	assert.equal(en.title, 'Subagent: explore-engine');
	assert.equal(en.riskLabel, 'External side effect');
	assert.equal(en.subjectLabel, 'Subagent Spec');
});

test('shellApprovalIntent returns semantic ids; formatShellIntentEn maps English', () => {
	assert.equal(shellApprovalIntent('npm run dev'), 'dev_server');
	assert.equal(shellApprovalIntent('pnpm install'), 'install_deps');
	assert.equal(formatShellIntentEn('dev_server'), 'Start development server');
	assert.equal(formatShellIntentEn('install_deps'), 'Install project dependencies');
});
