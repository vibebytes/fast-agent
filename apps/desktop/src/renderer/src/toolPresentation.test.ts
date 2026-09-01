import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {
	displayToolOutput,
	isSkillView,
	isSubagentTool,
	parseSkillEnvelope,
	parseSubagentPayload,
	shouldHideToolItem,
	skillViewBody,
	skillViewName
} from './toolPresentation.js';

const skill = {
	tool: 'skill_view',
	status: 'success' as const,
	output: null,
	summary: '{"name":"improve-codebase-architecture"}'
};

test('silent completed skill_view metadata is omitted from the transcript', () => {
	assert.equal(shouldHideToolItem(skill), true);
	assert.equal(shouldHideToolItem({...skill, status: 'running'}), false);
	assert.equal(shouldHideToolItem({...skill, status: 'error'}), false);
	assert.equal(shouldHideToolItem({...skill, output: '# Skill'}), false);
	assert.equal(shouldHideToolItem({...skill, tool: 'shell'}), false);
});

test('parseSubagentPayload unwraps subagent JSON args and prompt', () => {
	const agentDir = join(homedir(), 'agent');
	const raw = `{"input":${JSON.stringify(JSON.stringify({name: 'explore-engine', input: `探索${agentDir}`, tools: ['read_file', 'grep']}))}}`;
	const parsed = parseSubagentPayload(raw);
	assert.equal(parsed.name, 'explore-engine');
	assert.equal(parsed.prompt, `探索${agentDir}`);
	assert.deepEqual(parsed.tools, ['read_file', 'grep']);
});

test('skill_view presentation humanizes metadata and strips YAML frontmatter', () => {
	const output = [
		`<skill name="codebase-design" location="${join(homedir(), '.agents', 'skills', 'codebase-design', 'SKILL.md')}">`,
		`References are relative to ${join(homedir(), '.agents', 'skills', 'codebase-design')}.`,
		'<available_resources> <file>DEEPENING.md</file> <file>DESIGN-IT-TWICE.md</file> <file>SKILL.md</file> </available_resources>',
		'---',
		'name: codebase-design',
		'description: Improve architecture',
		'---',
		'',
		'# Codebase Design',
		'',
		'Read the project first.'
	].join('\n');

	assert.equal(isSkillView(' Skill_View '), true);
	assert.equal(skillViewName(skill.summary, output), 'improve-codebase-architecture');
	assert.equal(skillViewName(null, output), 'codebase-design');

	const {meta, body} = parseSkillEnvelope(output);
	assert.equal(meta.name, 'codebase-design');
	assert.equal(meta.location, join(homedir(), '.agents', 'skills', 'codebase-design', 'SKILL.md'));
	assert.deepEqual(meta.resources, ['DEEPENING.md', 'DESIGN-IT-TWICE.md', 'SKILL.md']);
	assert.equal(
		body,
		'# Codebase Design\n\nRead the project first.'
	);
});

test('raw cached shell envelope is unwrapped again at the renderer seam', () => {
	const raw =
		'{"status":"exited","outputPreview":"modules/runtime/storage/postgres/src/A.scala:7:object A\\nmodules/runtime/storage/postgres/src/B.scala:9:object B","exitCode":0}';
	assert.equal(
		displayToolOutput(raw),
		[
			'modules/runtime/storage/postgres/src/A.scala:7:object A',
			'modules/runtime/storage/postgres/src/B.scala:9:object B'
		].join('\n')
	);
});

test('renderer recovers an envelope whose escaped preview newlines were already expanded', () => {
	const malformed = [
		'{"status":"exited","outputPreview":"bridge',
		'cluster',
		'engine',
		'llm","outFile":"/tmp/tool.log","procId":"p1","exitCode":0,"reason":null}'
	].join('\n');
	assert.equal(displayToolOutput(malformed), ['bridge', 'cluster', 'engine', 'llm'].join('\n'));
});

test('renderer extracts outputPreview from truncated unclosed JSON envelope', () => {
	const truncated1 = '{"status":"exited","outputPreview":"---\\nmodules/runtime/cluster/src/m';
	assert.equal(
		displayToolOutput(truncated1),
		'---\nmodules/runtime/cluster/src/m'
	);

	const truncated2 = '{"status":"exited","outputPreview":"AgentInstanceUpsert.scala h2=1 pg=';
	assert.equal(
		displayToolOutput(truncated2),
		'AgentInstanceUpsert.scala h2=1 pg='
	);
});
