import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {previewBodyLines, structureWorkPreview} from './workPreview';

describe('structureWorkPreview', () => {
	it('parses tool_result + shell JSON envelope', () => {
		const raw = `</tool_result><tool_result name="shell" success="true">
output: {"status":"exited","outputPreview":"Back to homepage\\nClimate","exitCode":0}
</tool_result>`;
		const s = structureWorkPreview(raw);
		assert.ok(s);
		assert.equal(s!.tool, 'shell');
		assert.equal(s!.success, true);
		assert.equal(s!.exitCode, 0);
		assert.equal(s!.status, 'exited');
		assert.match(s!.body, /Back to homepage/);
		assert.match(s!.headline, /shell/);
		assert.doesNotMatch(s!.headline, /tool_result/);
		assert.doesNotMatch(s!.body, /tool_result/);
	});

	it('recovers broken streaming fragment without leading <', () => {
		const raw = `tool_result name="shell" success="true">
output: {"status":"exited","outputPreview":"ok line","exitCode":0}
</tool_result>`;
		const s = structureWorkPreview(raw);
		assert.equal(s?.tool, 'shell');
		assert.equal(s?.body.trim(), 'ok line');
	});

	it('previewBodyLines keeps last non-empty lines', () => {
		assert.equal(previewBodyLines('a\n\nb\nc\nd', 2), 'c\nd');
	});

	it('keeps tool success=true with exit 1; surfaces outFile instead of JSON body', () => {
		// Non-zero exitCode + status=exited = process finished, not a tool-call failure.
		const raw = `<tool_result name="shell" success="true">
output: {"status":"exited","outFile":"${join(homedir(), 'Documents', 'x', '.fast', 'artifacts', 'terminal', 'ac8.log')}","procId":"ac8","exitCode":1,"reason":null}
</tool_result>`;
		const s = structureWorkPreview(raw);
		assert.ok(s);
		assert.equal(s!.tool, 'shell');
		assert.equal(s!.success, true);
		assert.equal(s!.exitCode, 1);
		assert.equal(s!.status, 'exited');
		assert.equal(s!.outFile?.endsWith('ac8.log'), true);
		assert.equal(s!.body, '');
		assert.match(s!.headline, /ok/);
		assert.match(s!.headline, /exit 1/);
		assert.doesNotMatch(s!.headline, /fail/);
	});
});
