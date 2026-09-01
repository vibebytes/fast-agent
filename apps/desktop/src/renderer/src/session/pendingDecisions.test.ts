import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';
import {
	__resetPendingDecisionsForTests,
	decisionFor,
	pruned,
	pruneDecisions,
	sendApprovalDecision,
	sendQuestionAnswer,
	sendQuestionBatch,
	withAcked,
	withFailed,
	withSent
} from './pendingDecisions.js';

type FastIdeMock = {
	decideApproval: (id: string, approved: boolean, reason?: string) => Promise<boolean>;
	answerQuestion: (id: string, answer: string) => Promise<boolean>;
	answerQuestionBatch: (
		rpcId: string,
		payload: {answers: Array<{id: string; selected: string[]; custom?: string}>} | {cancelled: true}
	) => Promise<boolean>;
};

function mockFastIde(overrides: Partial<FastIdeMock> = {}): {calls: unknown[][]} {
	const calls: unknown[][] = [];
	const fastIde: FastIdeMock = {
		decideApproval: async (...args) => {
			calls.push(['decideApproval', ...args]);
			return true;
		},
		answerQuestion: async (...args) => {
			calls.push(['answerQuestion', ...args]);
			return true;
		},
		answerQuestionBatch: async (...args) => {
			calls.push(['answerQuestionBatch', ...args]);
			return true;
		},
		...overrides
	};
	(globalThis as Record<string, unknown>).window = {fastIde};
	return {calls};
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const SCOPE_A = 'task-a';
const SCOPE_B = 'task-b';

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return {promise, resolve, reject};
}

beforeEach(() => {
	__resetPendingDecisionsForTests();
});

// ── Pure transitions ─────────────────────────────────────────────────────────

test('withSent adds a record; ack/failure annotate without replacing its decision', () => {
	const m1 = withSent({}, 'a1', {label: 'Allowed', approved: true}, 100);
	assert.deepEqual(m1['a1'], {label: 'Allowed', approved: true, sentAt: 100});
	const acked = withAcked(m1, 'a1');
	assert.equal(acked['a1']!.acked, true);
	const failed = withFailed(m1, 'a1', 'nope', 200);
	assert.equal(failed['a1']!.failed, 'nope');
	assert.equal(failed['a1']!.label, 'Allowed', 'failure keeps the original label');
});

test('pruned drops resolved ids and keeps reference identity when nothing changed', () => {
	const map = withSent(withSent({}, 'a1', {label: 'Allowed'}, 1), 'q1', {label: 'opt'}, 2);
	const same = pruned(map, new Set(['a1', 'q1']));
	assert.equal(same, map, 'no change → same reference (memo discipline)');
	const dropped = pruned(map, new Set(['q1']));
	assert.deepEqual(Object.keys(dropped), ['q1']);
});

// ── Store actions ────────────────────────────────────────────────────────────

test('sendApprovalDecision records optimistically and keeps the record on ack', async () => {
	mockFastIde();
	sendApprovalDecision(SCOPE_A, 'a1', true);
	assert.equal(
		decisionFor(SCOPE_A, 'approval', 'a1')?.label,
		'Allowed',
		'record exists before IPC resolves'
	);
	await tick();
	assert.equal(decisionFor(SCOPE_A, 'approval', 'a1')?.acked, true);
	assert.equal(
		decisionFor(SCOPE_A, 'approval', 'a1')?.failed,
		undefined,
		'ack leaves the record pending engine events'
	);
});

test('sendApprovalDecision labels: deny and always', async () => {
	mockFastIde();
	sendApprovalDecision(SCOPE_A, 'd1', false);
	sendApprovalDecision(SCOPE_A, 'w1', true, 'always');
	assert.equal(decisionFor(SCOPE_A, 'approval', 'd1')?.label, 'Denied');
	assert.equal(decisionFor(SCOPE_A, 'approval', 'd1')?.approved, false);
	assert.equal(decisionFor(SCOPE_A, 'approval', 'w1')?.label, 'Always allowed');
	await tick();
});

test('send failure stays compact and non-interactive', async () => {
	mockFastIde({decideApproval: async () => false});
	sendApprovalDecision(SCOPE_A, 'a1', true);
	await tick();
	assert.ok(decisionFor(SCOPE_A, 'approval', 'a1')?.failed, 'IPC false → compact failure hint');
	const calls = mockFastIde().calls;
	sendApprovalDecision(SCOPE_A, 'a1', true);
	await tick();
	assert.equal(calls.length, 0, 'failed decision remains a duplicate-submit guard');
});

test('rejected IPC promise is observable on the compact decision', async () => {
	mockFastIde({answerQuestion: async () => Promise.reject(new Error('transport down'))});
	sendQuestionAnswer(SCOPE_A, 'q1', 'x');
	await tick();
	assert.match(
		decisionFor(SCOPE_A, 'question', 'q1')?.failed ?? '',
		/Failed to send answer/,
		'rejection must not become an unhandled promise'
	);
});

test('sendQuestionBatch records immediately and wires answers or cancel', async () => {
	const {calls} = mockFastIde();
	sendQuestionBatch(SCOPE_A, 'rpc-1', {answers: [{id: 'q1', selected: ['Yes']}]}, 'Submit');
	assert.equal(decisionFor(SCOPE_A, 'questionBatch', 'rpc-1')?.label, 'Submit');
	await tick();
	assert.deepEqual(calls[0], [
		'answerQuestionBatch',
		'rpc-1',
		{answers: [{id: 'q1', selected: ['Yes']}]}
	]);
	sendQuestionBatch(SCOPE_A, 'rpc-2', {cancelled: true}, 'Cancel');
	assert.equal(decisionFor(SCOPE_A, 'questionBatch', 'rpc-2')?.label, 'Cancel');
	await tick();
	assert.deepEqual(calls[1], ['answerQuestionBatch', 'rpc-2', {cancelled: true}]);
});

test('sendQuestionAnswer uses the display label, not the option id', async () => {
	const {calls} = mockFastIde();
	sendQuestionAnswer(SCOPE_A, 'q1', '1', 'Use pnpm');
	assert.equal(decisionFor(SCOPE_A, 'question', 'q1')?.label, 'Use pnpm');
	await tick();
	assert.deepEqual(calls[0], ['answerQuestion', 'q1', '1'], 'wire carries the option id');
});

test('duplicate click while IPC is pending sends exactly once', async () => {
	const pending = deferred<boolean>();
	let sends = 0;
	mockFastIde({
		decideApproval: () => {
			sends += 1;
			return pending.promise;
		}
	});
	sendApprovalDecision(SCOPE_A, 'a1', true);
	sendApprovalDecision(SCOPE_A, 'a1', true);
	assert.equal(sends, 1);
	pending.resolve(true);
	await tick();
});

test('cross-card isolation: deciding one card keeps other records reference-stable', async () => {
	mockFastIde();
	sendApprovalDecision(SCOPE_A, 'a1', true);
	const a1Before = decisionFor(SCOPE_A, 'approval', 'a1');
	sendQuestionAnswer(SCOPE_A, 'q1', 'x');
	assert.equal(
		decisionFor(SCOPE_A, 'approval', 'a1'),
		a1Before,
		'unrelated decision keeps a1 record identity'
	);
	await tick();
});

test('pruneDecisions converges only the selected Task scope', async () => {
	mockFastIde();
	sendApprovalDecision(SCOPE_A, 'same-id', true);
	sendQuestionAnswer(SCOPE_A, 'q1', 'x');
	sendQuestionBatch(SCOPE_A, 'rpc-1', {cancelled: true}, 'Cancel');
	sendQuestionAnswer(SCOPE_B, 'same-id', 'other task');
	await tick();
	pruneDecisions(SCOPE_A, new Set(), new Set(['q1']), new Set(['rpc-1']));
	assert.equal(
		decisionFor(SCOPE_A, 'approval', 'same-id'),
		undefined,
		'engine resolved approval → record dropped'
	);
	assert.equal(
		decisionFor(SCOPE_A, 'question', 'q1')?.label,
		'x',
		'still-pending record survives'
	);
	assert.equal(
		decisionFor(SCOPE_A, 'questionBatch', 'rpc-1')?.label,
		'Cancel',
		'still-pending batch survives'
	);
	assert.equal(
		decisionFor(SCOPE_B, 'question', 'same-id')?.label,
		'other task',
		'switching/pruning Task A must not erase Task B'
	);
	pruneDecisions(SCOPE_A, new Set(), new Set());
	assert.equal(decisionFor(SCOPE_A, 'question', 'q1'), undefined);
});

test('approval/question ids do not collide within a Task', async () => {
	mockFastIde();
	sendApprovalDecision(SCOPE_A, 'same', true);
	sendQuestionAnswer(SCOPE_A, 'same', 'option');
	assert.equal(decisionFor(SCOPE_A, 'approval', 'same')?.label, 'Allowed');
	assert.equal(decisionFor(SCOPE_A, 'question', 'same')?.label, 'option');
	await tick();
});

test('late failed response after authoritative prune cannot resurrect a record', async () => {
	const pending = deferred<boolean>();
	mockFastIde({decideApproval: () => pending.promise});
	sendApprovalDecision(SCOPE_A, 'a1', true);
	pruneDecisions(SCOPE_A, new Set(), new Set());
	assert.equal(decisionFor(SCOPE_A, 'approval', 'a1'), undefined);

	pending.resolve(false);
	await tick();
	assert.equal(
		decisionFor(SCOPE_A, 'approval', 'a1'),
		undefined,
		'late completion belongs to the pruned request generation'
	);
});
