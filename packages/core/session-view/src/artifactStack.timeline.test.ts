import test from 'node:test';
import assert from 'node:assert/strict';
import {wrapProcessStacks, type TimelineItem} from './index.js';

const ARTIFACT =
	'<fast-artifact>{"kind":"scene","title":"Room 1","meta":["12 objects"],"open":{"kind":"surface","extId":"vibe3d","surfaceId":"vibe3d.editor","url":"https://editor.example/r/r_1"}}</fast-artifact>';

function tool(id: string, name: string, output: string | null): TimelineItem {
	return {
		kind: 'tool',
		id,
		tool: name,
		status: 'success',
		title: name,
		command: null,
		output,
		exitCode: null,
		summary: null
	};
}

function ids(items: readonly TimelineItem[]): string[] {
	return items.map(i => (i.kind === 'tool' ? `tool:${i.id}` : i.kind));
}

test('a tool result carrying an artifact is not folded into a process stack', () => {
	const items = [
		tool('t1', 'glob', 'a.ts'),
		tool('t2', 'room.create', ARTIFACT),
		tool('t3', 'glob', 'b.ts')
	];
	const out = wrapProcessStacks(items, {turnActive: false, entryId: 'e'});
	assert.equal(out.filter(i => i.kind === 'processStack').length, 0);
	assert.deepEqual(ids(out), ['tool:t1', 'tool:t2', 'tool:t3']);
});

test('an artifact tool between sealed steps breaks the stack instead of joining it', () => {
	const thought: TimelineItem = {
		kind: 'thought',
		id: 'th1',
		text: 'create a room',
		chrome: {} as never,
		open: false
	};
	const out = wrapProcessStacks(
		[thought, tool('t1', 'room.create', ARTIFACT), thought],
		{turnActive: false, entryId: 'e'}
	);
	assert.deepEqual(ids(out), ['thought', 'tool:t1', 'thought']);
	for (const stack of out.filter(i => i.kind === 'processStack')) {
		const steps = stack.kind === 'processStack' ? stack.steps : [];
		assert.equal(
			steps.some(s => s.kind === 'tool' && s.id === 't1'),
			false,
			'artifact tool must stay a top-level row'
		);
	}
});

test('plain successful tools still stack', () => {
	const out = wrapProcessStacks([tool('t1', 'glob', 'a.ts'), tool('t2', 'glob', 'b.ts')], {
		turnActive: false,
		entryId: 'e'
	});
	assert.equal(out.length, 1);
	assert.equal(out[0]?.kind, 'processStack');
	assert.equal(out[0]?.kind === 'processStack' ? out[0].stepCount : 0, 2);
});
