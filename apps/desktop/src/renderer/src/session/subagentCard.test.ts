import test from 'node:test';
import assert from 'node:assert/strict';
import {subagentCardChrome, subagentPreviewLines} from './SubagentWorkCard';

test('inactive without Finished is muted; live Finished may check', () => {
	const muted = subagentCardChrome({mode: 'one-shot', activity: 'inactive'});
	assert.equal(muted.statusLabel, '已结束');
	assert.equal(muted.showCheck, false);
	assert.equal(muted.tone, 'ended');
	const idle = subagentCardChrome({mode: 'continuable', activity: 'inactive'});
	assert.equal(idle.statusLabel, '空闲');
	assert.equal(idle.showCheck, false);
	const live = subagentCardChrome({
		mode: 'one-shot',
		activity: 'inactive',
		status: 'completed'
	});
	assert.equal(live.showCheck, true);
	assert.equal(live.tone, 'success');
});

test('subagentPreviewLines keeps the last 12 plain-text lines', () => {
	const lines = Array.from({length: 12}, (_, i) => `L${i + 1}`);
	assert.equal(subagentPreviewLines(lines.join('\n'), 12), lines.join('\n'));
	assert.equal(subagentPreviewLines([...lines, 'L13'].join('\n'), 12), [...lines.slice(1), 'L13'].join('\n'));
	assert.equal(subagentPreviewLines(undefined, 12), '');
	assert.equal(subagentPreviewLines('', 12), '');
	assert.equal(subagentPreviewLines('read_file src/A.scala\nHello', 12), 'read_file src/A.scala\nHello');
	const running = subagentCardChrome({mode: 'one-shot', activity: 'running'});
	assert.equal(running.statusLabel, '运行中');
	assert.equal(running.tone, 'running');
});
