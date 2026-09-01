/**
 * Pipeline equivalence replay (perf doc P0-1 gate test).
 *
 * Drives real Bridge event sequences through SessionController (projection) +
 * UiPublisher (tail-diff publish) and feeds every published channel into the
 * real renderer reducer. The renderer body must end deep-equal to the main
 * process authority, while content flushes stay incremental (tail ≪ total).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import type {UiSend, WorkspaceFocus} from '@fast-ide/session-view';
import {SessionController} from './SessionController.js';
import {isSessionStreamEvent} from './sessionStreamEvents.js';
import {createUiPublisher, type UiPublisher} from './uiPublisher.js';
import type {WorkspaceHub} from './WorkspaceHub.js';
import {
	initialWorkspaceState,
	reduceWorkspace,
	type WorkspaceEvent,
	type WorkspaceState
} from '../../renderer/src/workspaceStore.js';

function withSid(sessionId: string, event: BridgeEvent): BridgeEvent {
	if (!isSessionStreamEvent(event.type)) return event;
	return {...event, sessionId} as BridgeEvent;
}

type Harness = {
	controller: SessionController;
	publisher: UiPublisher;
	taskId: string;
	sessionId: string;
	feed: (event: BridgeEvent) => void;
	flush: () => void;
	settle: () => Promise<void>;
	rendererState: () => WorkspaceState;
	sentTailPatches: () => Array<{from: number; total: number; entries: unknown[]}>;
};

function pipeline(sessionId: string): Harness {
	const commands: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			commands.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `cid-${++n}`;
		})()
	});
	const task = controller.createTask('T');
	controller.acceptNewSession(sessionId, task.id);
	controller.handleEvent({type: 'Attached', sessionId, clientId: 'cli'});

	const hub = {
		getActive: () => ({
			id: 'p1',
			path: '/tmp/p1',
			status: 'ready',
			error: null,
			cwd: '/tmp/p1',
			displayName: undefined,
			sessions: controller
		}),
		getById: () => null,
		getDefaultProject: () => null,
		listProjects: () => [],
		getEngineStatus: () => ({status: 'ready' as const, error: null})
	} as unknown as WorkspaceHub;

	let state = initialWorkspaceState();
	const tailPatches: Array<{from: number; total: number; entries: unknown[]}> = [];
	const timers: Array<() => void> = [];

	const send: UiSend = (channel, payload) => {
		if (channel === 'transcript:patched') {
			state = reduceWorkspace(state, {
				type: 'transcript:patched',
				payload
			} as WorkspaceEvent);
		} else if (channel === 'transcript:tailPatched') {
			const p = payload as {from: number; total: number; entries: unknown[]};
			tailPatches.push({from: p.from, total: p.total, entries: p.entries});
			state = reduceWorkspace(state, {
				type: 'transcript:tailPatched',
				payload
			} as WorkspaceEvent);
		} else if (channel === 'tasks:changed') {
			state = reduceWorkspace(state, {type: 'tasks:changed', payload} as WorkspaceEvent);
		} else if (channel === 'projects:changed') {
			state = reduceWorkspace(state, {type: 'projects:changed', payload} as WorkspaceEvent);
		} else if (channel === 'project:changed') {
			state = reduceWorkspace(state, {type: 'project:changed', payload} as WorkspaceEvent);
		} else if (channel === 'workspace:focus') {
			state = reduceWorkspace(state, {
				type: 'workspace:focus',
				payload: payload as WorkspaceFocus
			} as WorkspaceEvent);
		}
		// bridge:event and friends are not store channels.
	};

	const publisher = createUiPublisher({
		hub,
		send,
		setTimeoutFn: ((fn: () => void) => {
			timers.push(fn);
			return timers.length as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout,
		clearTimeoutFn: ((id: ReturnType<typeof setTimeout>) => {
			const idx = (id as unknown as number) - 1;
			if (idx >= 0 && idx < timers.length) timers[idx] = () => {};
		}) as typeof clearTimeout
	});

	// Focus establishes renderer selection + the tail-diff baseline (same as app boot).
	publisher.publishFocusChange();

	return {
		controller,
		publisher,
		taskId: task.id,
		sessionId,
		feed(event) {
			const ev = withSid(sessionId, event);
			controller.handleEvent(ev);
			publisher.handleEvent('p1', ev);
		},
		flush() {
			while (timers.length > 0) {
				const fn = timers.shift()!;
				fn();
			}
		},
		/** Snapshot publishes coalesce per microtask (P2-13) — settle before asserting. */
		settle: () => new Promise<void>(resolve => queueMicrotask(() => queueMicrotask(resolve))),
		rendererState: () => state,
		sentTailPatches: () => tailPatches
	};
}

function assertBodyEquivalence(h: Harness): void {
	const authority = h.controller.getActiveTask()!;
	const renderer = h.rendererState().byTaskId[h.taskId];
	assert.ok(renderer, 'renderer must hold a body for the task');
	assert.deepEqual(renderer.entries, authority.transcript.entries, 'entries drifted');
	assert.deepEqual(renderer.approvals, authority.transcript.approvals, 'approvals drifted');
	assert.deepEqual(renderer.questions, authority.transcript.questions, 'questions drifted');
	assert.deepEqual(renderer.codeChanges, authority.codeChanges.entries, 'codeChanges drifted');
}

test('REPLAY: streaming turn with tools stays equivalent under tail patches', async () => {
	const h = pipeline('sess-replay');

	h.feed({type: 'turn_started', turnId: 't1', clientMessageId: 't1', text: 'hi'} as BridgeEvent);
	h.feed({type: 'thinking_started', turn: 1, maxTurns: 1, turnId: 't1'} as BridgeEvent);
	for (let i = 0; i < 12; i++) {
		h.feed({type: 'reasoning_delta', turnId: 't1', text: `r${i} `} as BridgeEvent);
		if (i % 5 === 4) h.flush();
	}
	for (let i = 0; i < 40; i++) {
		h.feed({type: 'assistant_delta', turnId: 't1', text: `token-${i} `} as BridgeEvent);
		if (i % 3 === 2) h.flush();
	}
	h.feed({
		type: 'tool_started',
		turnId: 't1',
		id: 'tool-1',
		tool: 'shell_execute',
		args: {command: 'ls'}
	} as BridgeEvent);
	h.flush();
	for (let i = 0; i < 10; i++) {
		h.feed({
			type: 'tool_output',
			turnId: 't1',
			id: 'tool-1',
			tool: 'shell_execute',
			stream: 'stdout',
			text: `line-${i}\n`
		} as BridgeEvent);
	}
	h.flush();
	h.feed({
		type: 'tool_finished',
		turnId: 't1',
		id: 'tool-1',
		tool: 'shell_execute',
		success: true,
		fields: {}
	} as BridgeEvent);
	for (let i = 0; i < 10; i++) {
		h.feed({type: 'assistant_delta', turnId: 't1', text: `tail-${i} `} as BridgeEvent);
	}
	h.flush();
	h.feed({type: 'turn_finished', turnId: 't1', success: true} as BridgeEvent);
	h.flush();

	await h.settle();
	h.flush();
	assertBodyEquivalence(h);

	const tails = h.sentTailPatches();
	assert.ok(tails.length > 0, 'content flushes must use the tail channel');
	for (const t of tails) {
		assert.ok(t.entries.length <= t.total, 'tail cannot exceed total');
	}
	assert.ok(
		tails.some(t => t.total > 1 && t.entries.length < t.total),
		'at least one flush must be a strict tail (not a full resend)'
	);
});

test('REPLAY: subagent delegation (agent_call adopt + finish) stays equivalent', async () => {
	const h = pipeline('sess-agent');

	h.feed({type: 'turn_started', turnId: 't1', clientMessageId: 't1', text: 'go'} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'delegating '} as BridgeEvent);
	h.flush();
	h.feed({
		type: 'agent_call_started',
		agentId: 'ag-1',
		runId: 'run-9',
		turnId: 't1',
		name: 'researcher'
	} as BridgeEvent);
	h.flush();
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'still working '} as BridgeEvent);
	h.flush();
	h.feed({
		type: 'agent_call_finished',
		agentId: 'ag-1',
		runId: 'run-9',
		turnId: 't1',
		success: true,
		resultSummary: 'found 3 files'
	} as BridgeEvent);
	h.flush();
	h.feed({type: 'turn_finished', turnId: 't1', success: true} as BridgeEvent);
	h.flush();

	await h.settle();
	h.flush();
	assertBodyEquivalence(h);
});

test('REPLAY: goal track — goalCard push + step-turn deltas reach the renderer', async () => {
	const h = pipeline('sess-goal');

	// /goal skill turn starts and settles the goal.
	h.feed({type: 'turn_started', turnId: 'g1', clientMessageId: 'g1', text: '/goal 调研'} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 'g1', text: '目标已启动 '} as BridgeEvent);
	h.flush();
	h.feed({type: 'turn_finished', turnId: 'g1', success: true} as BridgeEvent);
	await h.settle();

	// Goal card lifecycle push (running) — must ride a publish to the renderer.
	h.feed({
		type: 'goal_updated',
		goalId: 'goal-1',
		phase: 'started',
		status: 'running',
		name: 'YC调研'
	} as BridgeEvent);
	await h.settle();
	h.flush();

	const cardAfterStart = h.rendererState().byTaskId[h.taskId]?.goalCard;
	assert.equal(cardAfterStart?.goalId, 'goal-1', 'goalCard must reach the renderer');
	assert.equal(cardAfterStart?.status, 'running');

	// Unified LiveChildWork wire: the goal's step run (researcher) must surface
	// as a drawer row while it works.
	h.feed({
		type: 'child_work_changed',
		kind: 'run',
		id: 'step-run-1',
		parentRef: 'goal:goal-1',
		title: 'researcher',
		status: 'running',
		summary: '核实最新 YC batch'
	} as BridgeEvent);
	h.flush();
	await h.settle();
	h.flush();
	const working = h.rendererState().byTaskId[h.taskId]?.childWork ?? [];
	assert.equal(working.length, 1, 'child work row must reach the renderer');
	assert.equal(working[0]?.title, 'researcher');

	h.feed({
		type: 'child_work_changed',
		kind: 'run',
		id: 'step-run-1',
		title: 'researcher',
		status: 'completed'
	} as BridgeEvent);
	h.flush();
	await h.settle();
	h.flush();
	assert.equal(
		(h.rendererState().byTaskId[h.taskId]?.childWork ?? []).length,
		0,
		'terminal child work must clear the row'
	);

	// Goal step turn streams on the same session — deltas must keep flowing.
	h.feed({type: 'turn_started', turnId: 'step-1', clientMessageId: 'step-1', text: 'step'} as BridgeEvent);
	await h.settle();
	for (let i = 0; i < 10; i++) {
		h.feed({type: 'assistant_delta', turnId: 'step-1', text: `progress-${i} `} as BridgeEvent);
		if (i % 4 === 3) h.flush();
	}
	h.flush();
	await h.settle();
	h.flush();

	assertBodyEquivalence(h);
	const entries = h.rendererState().byTaskId[h.taskId]!.entries;
	const stepEntry = entries.find(e => e.turnId === 'step-1' && e.role === 'assistant');
	assert.ok(stepEntry, 'goal step turn must project into the transcript');
	assert.ok(
		stepEntry!.text.includes('progress-9'),
		'step deltas must stream to the renderer'
	);
});

test('REPLAY: multi-turn with interleaved snapshot publishes stays equivalent', async () => {
	const h = pipeline('sess-multi');

	for (let turn = 1; turn <= 3; turn++) {
		const id = `t${turn}`;
		h.feed({
			type: 'turn_started',
			turnId: id,
			clientMessageId: id,
			text: `prompt ${turn}`
		} as BridgeEvent);
		for (let i = 0; i < 20; i++) {
			h.feed({type: 'assistant_delta', turnId: id, text: `w${turn}-${i} `} as BridgeEvent);
			if (i % 7 === 6) h.flush();
		}
		h.flush();
		h.feed({type: 'turn_finished', turnId: id, success: true} as BridgeEvent);
		h.flush();
	}

	await h.settle();
	h.flush();
	assertBodyEquivalence(h);

	// Streaming flushes must stay narrow. Turn boundaries may carry a few new
	// rows (user + assistant) when a content flush lands before the coalesced
	// snapshot publish (P2-13) — but never anything near the full transcript.
	const tails = h.sentTailPatches().filter(t => t.total > 1);
	assert.ok(tails.length > 0);
	assert.ok(
		tails.every(t => t.entries.length <= 4),
		`streaming tails must stay narrow, got ${JSON.stringify(tails.map(t => t.entries.length))}`
	);
});
