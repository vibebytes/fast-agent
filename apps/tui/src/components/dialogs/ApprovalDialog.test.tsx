import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {ApprovalDialog, extractCommandFromToolCall} from './ApprovalDialog.js';
import {renderWithProviders, plainFrame} from '../../test-utils/render.js';
import {initialState} from '../../state/model.js';
import type {Approval} from '../../state/model.js';

const shellApproval: Approval = {
	id: 'approval_1',
	turnId: 'turn_1',
	tool: 'shell',
	description: 'Run destructive command',
	risk: 'Shell',
	context: 'rm -rf node_modules'
};

const deleteApproval: Approval = {
	id: 'approval_2',
	turnId: 'turn_1',
	tool: 'delete_file',
	description: 'Delete file',
	risk: 'Destructive',
	context: 'src/old.ts'
};

test('ApprovalDialog renders shell command context', () => {
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(<ApprovalDialog approval={shellApproval} />, {state});
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /Bash command/);
	assert.match(frame, /rm -rf node_modules/);
	assert.match(frame, /Do you want to proceed/);
	app.unmount();
});

test('ApprovalDialog renders y/n/a options', () => {
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(<ApprovalDialog approval={shellApproval} />, {state});
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /yes/i);
	assert.match(frame, /no/i);
	assert.match(frame, /always/i);
	app.unmount();
});

test('ApprovalDialog renders risk label for shell', () => {
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(<ApprovalDialog approval={shellApproval} />, {state});
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /\[Shell\]/);
	app.unmount();
});

test('ApprovalDialog renders delete_file tool details', () => {
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(<ApprovalDialog approval={deleteApproval} />, {state});
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /Delete file/);
	assert.match(frame, /src\/old\.ts/);
	app.unmount();
});

test('extractCommandFromToolCall extracts command from various tool call formats', () => {
	// 1. Plain command
	assert.equal(extractCommandFromToolCall('rm -rf node_modules'), 'rm -rf node_modules');

	// 2. Full JSON inside tool_name(...)
	assert.equal(
		extractCommandFromToolCall('shell({"command":"cd /app && sleep 2"})'),
		'cd /app && sleep 2'
	);

	// 3. Full JSON without tool_name(...)
	assert.equal(
		extractCommandFromToolCall('{"command":"cd /app && sleep 2"}'),
		'cd /app && sleep 2'
	);

	// 4. Truncated JSON inside tool_name(...)
	assert.equal(
		extractCommandFromToolCall('shell({"command":"cd /app && sleep 2'),
		'cd /app && sleep 2'
	);

	// 5. Truncated JSON without tool_name(...)
	assert.equal(
		extractCommandFromToolCall('{"command":"cd /app && sleep 2'),
		'cd /app && sleep 2'
	);

	// 6. Other fields like args/input/file/path
	assert.equal(
		extractCommandFromToolCall('git({"args":"status"})'),
		'status'
	);
	assert.equal(
		extractCommandFromToolCall('delete_file({"path":"src/old.ts"})'),
		'src/old.ts'
	);

	// 7. edit_file — small diff (<= 4 lines each)
	const smallDiff = extractCommandFromToolCall('edit_file({"path":"src/a.ts","old_string":"foo\\nbar\\nbaz","new_string":"foo\\nbar\\nqux"})');
	assert.match(smallDiff, /edit_file\(src\/a\.ts\)/);
	assert.match(smallDiff, /--- old/);
	assert.match(smallDiff, /\+qux/);
	assert.match(smallDiff, /-baz/);

	// 8. edit_file — large diff (> 4 lines each, truncated)
	const oldBig = Array.from({length: 10}, (_, i) => 'line' + i).join('\\n');
	const newBig = Array.from({length: 10}, (_, i) => 'line' + i + (i === 5 ? ' MODIFIED' : '')).join('\\n');
	const bigDiff = extractCommandFromToolCall(`edit_file({"path":"src/big.ts","old_string":"${oldBig}","new_string":"${newBig}"})`);
	assert.match(bigDiff, /edit_file\(src\/big\.ts\)/);
	assert.match(bigDiff, /\.\.\. \(4 more lines\)/);
	assert.match(bigDiff, /-line5/);
	assert.match(bigDiff, /\+line5 MODIFIED/);

	// 9. edit_file — empty old_string (new file)
	const newFile = extractCommandFromToolCall('edit_file({"path":"new.ts","old_string":"","new_string":"content"})');
	assert.match(newFile, /edit_file\(new\.ts\)/);
	assert.match(newFile, /\+content/);
});

// 60ms default: 30ms flaked under full-suite load (PTY tests saturate CPU and
// React commits between keystrokes slip past a 30ms window).
const tick = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

test('ApprovalDialog y/n/a keys decide immediately', async () => {
	for (const key of ['y', 'n', 'a'] as const) {
		const decisions: string[] = [];
		const state = {...initialState, ready: true, inputMode: 'approval' as const};
		const app = renderWithProviders(
			<ApprovalDialog approval={shellApproval} />,
			{state, decideApproval: (_a, decision) => { decisions.push(decision); return true; }}
		);
		await tick();
		app.stdin.write(key);
		await tick();
		assert.deepEqual(decisions, [key], `key ${key} must decide`);
		app.unmount();
	}
});

test('ApprovalDialog arrow selection + Enter maps options to decisions', async () => {
	const decisions: string[] = [];
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(
		<ApprovalDialog approval={shellApproval} />,
		{state, decideApproval: (_a, decision) => { decisions.push(decision); return true; }}
	);
	await tick();

	app.stdin.write('\u001B[B'); // move off "yes once"
	await tick();
	app.stdin.write('\r');
	await tick();
	assert.deepEqual(decisions, ['a'], 'second option is "always for this session"');
	app.unmount();
});

test('ApprovalDialog Esc denies', async () => {
	const decisions: string[] = [];
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(
		<ApprovalDialog approval={shellApproval} />,
		{state, decideApproval: (_a, decision) => { decisions.push(decision); return true; }}
	);
	app.stdin.write('\u001B');
	await tick(150);
	assert.deepEqual(decisions, ['n']);
	app.unmount();
});

test('ApprovalDialog blocks freeform text followed by Enter', async () => {
	const decisions: Array<'y' | 'n' | 'a'> = [];
	const notices: string[] = [];
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(
		<ApprovalDialog approval={shellApproval} />,
		{
			state,
			decideApproval: (_approval, decision) => {
				decisions.push(decision);
				return true;
			},
			dispatch: action => {
				if (action.type === 'notice') notices.push(action.text);
			}
		}
	);
	await tick();

	app.stdin.write('some random text');
	app.stdin.write('\r');
	await new Promise(resolve => setTimeout(resolve, 0));

	assert.deepEqual(decisions, []);
	assert.ok(notices.some(text => text.includes('Approval is pending')), 'pending notice emitted');
	app.unmount();
});

test('ApprovalDialog blocks batched freeform text with Enter', async () => {
	const decisions: Array<'y' | 'n' | 'a'> = [];
	const notices: string[] = [];
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(
		<ApprovalDialog approval={shellApproval} />,
		{
			state,
			decideApproval: (_approval, decision) => {
				decisions.push(decision);
				return true;
			},
			dispatch: action => {
				if (action.type === 'notice') notices.push(action.text);
			}
		}
	);
	await tick();

	app.stdin.write('some random text\r');
	await new Promise(resolve => setTimeout(resolve, 0));

	assert.deepEqual(decisions, []);
	assert.ok(notices.some(text => text.includes('Approval is pending')), 'pending notice emitted for batched input');
	app.unmount();
});

test('ApprovalDialog surfaces the freeform guard instead of silently eating y', async () => {
	const decisions: string[] = [];
	const notices: string[] = [];
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(
		<ApprovalDialog approval={shellApproval} />,
		{
			state,
			decideApproval: (_a, decision) => { decisions.push(decision); return true; },
			dispatch: action => {
				if (action.type === 'notice') notices.push(action.text);
			}
		}
	);
	await tick();

	// Stray text (e.g. the user typed a chat message at the dialog) arms the guard.
	app.stdin.write('继续');
	await tick();
	// A decision key is swallowed — but now with immediate, once-only feedback.
	app.stdin.write('y');
	await tick(60);
	assert.deepEqual(decisions, [], 'y after stray text must not decide');
	assert.equal(notices.filter(text => text.includes('Press Enter to clear')).length, 1, 'guard hint shown');
	app.stdin.write('y');
	await tick(60);
	assert.equal(notices.filter(text => text.includes('Press Enter to clear')).length, 1, 'hint not spammed');

	// Enter clears the stray text; the next y decides normally.
	app.stdin.write('\r');
	await tick(60);
	app.stdin.write('y');
	await tick(60);
	assert.deepEqual(decisions, ['y']);
	app.unmount();
});

// --- Decision state machine (submitting / escalated / failed) ---

test('ApprovalDialog dispatches approval_decision_sent and sends exactly one command per decision', async () => {
	const decisions: string[] = [];
	const sent: Array<{id: string; value: string}> = [];
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(
		<ApprovalDialog approval={shellApproval} />,
		{
			state,
			decideApproval: (_a, decision) => { decisions.push(decision); return true; },
			dispatch: action => {
				if (action.type === 'approval_decision_sent') sent.push({id: action.id, value: action.value});
			}
		}
	);
	await tick();

	// Repeated presses in quick succession: the in-flight guard must debounce
	// them to a single DecideApproval (the original N-zombie-writes bug).
	app.stdin.write('y');
	await tick();
	app.stdin.write('y');
	app.stdin.write('y');
	app.stdin.write('\r');
	await tick(60);

	assert.deepEqual(decisions, ['y'], 'exactly one command sent');
	assert.deepEqual(sent, [{id: 'approval_1', value: 'y'}], 'exactly one optimistic state transition');
	app.unmount();
});

test('ApprovalDialog renders compact submitting state for an in-flight decision', () => {
	const submitting: Approval = {...shellApproval, decision: {value: 'y', sentAt: Date.now()}};
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(<ApprovalDialog approval={submitting} />, {state});
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /已选择 Yes/, 'optimistic echo shows the chosen option');
	assert.match(frame, /执行中/, 'compact state signals progress');
	assert.doesNotMatch(frame, /Do you want to proceed/, 'full prompt collapses while submitting');
	app.unmount();
});

test('ApprovalDialog escalates to warning after 10s without approval_resolved', () => {
	const stuck: Approval = {...shellApproval, decision: {value: 'y', sentAt: Date.now() - 11_000, acked: true}};
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(<ApprovalDialog approval={stuck} />, {state});
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /引擎未确认审批/, 'escalation warning shown');
	assert.match(frame, /r 重发/, 'resend hint shown');
	app.unmount();
});

test('ApprovalDialog failed state offers retry and resends the same decision', async () => {
	const failed: Approval = {...shellApproval, decision: {value: 'a', sentAt: Date.now() - 2_000, acked: true, failed: '引擎未接受该审批决定（stale）'}};
	const decisions: string[] = [];
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(
		<ApprovalDialog approval={failed} />,
		{state, decideApproval: (_a, decision) => { decisions.push(decision); return true; }}
	);
	await tick();
	const frame = plainFrame(app.lastFrame());
	assert.match(frame, /审批决定未生效/, 'failed state visible');
	assert.match(frame, /stale/, 'failure reason visible');

	app.stdin.write('r');
	await tick(60);
	assert.deepEqual(decisions, ['a'], 'retry resends the original decision value');
	app.unmount();
});

test('ApprovalDialog shows elapsed wait time and open-ended reminder for long idle waits', () => {
	const longWait: Approval = {...shellApproval, requestedAt: Date.now() - 11 * 60_000};
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(<ApprovalDialog approval={longWait} />, {state});
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /已等待 11m/, 'elapsed time visible');
	assert.match(frame, /run 将持续等待/, 'open-ended wait reminder visible');
	assert.match(frame, /Do you want to proceed/, 'dialog still fully interactive');
	app.unmount();
});

test('ApprovalDialog hides elapsed time for fresh approvals', () => {
	const fresh: Approval = {...shellApproval, requestedAt: Date.now()};
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(<ApprovalDialog approval={fresh} />, {state});
	const frame = plainFrame(app.lastFrame());

	assert.doesNotMatch(frame, /已等待/, 'no elapsed display below one minute');
	app.unmount();
});

test('ApprovalDialog Esc cancels the run from failed state', async () => {
	const failed: Approval = {...shellApproval, decision: {value: 'y', sentAt: Date.now(), failed: '命令发送失败'}};
	let cancelled = 0;
	const decisions: string[] = [];
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(
		<ApprovalDialog approval={failed} />,
		{
			state,
			decideApproval: (_a, decision) => { decisions.push(decision); return true; },
			cancelTask: () => { cancelled += 1; }
		}
	);
	await tick();

	app.stdin.write('\u001B');
	await tick(60);
	assert.equal(cancelled, 1, 'Esc triggers run cancel');
	assert.deepEqual(decisions, [], 'Esc in failed state never re-decides');
	app.unmount();
});
