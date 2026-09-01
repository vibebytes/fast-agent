import assert from 'node:assert/strict';
import test from 'node:test';
import {
	currentStepIds,
	currentStepNames,
	pickIdList,
	wireIdList,
	workflowNodeStatus
} from './workflowNodeStatus';

const base = {
	currentStepId: null as string | null,
	completedSteps: new Set<string>(),
	pendingExtras: new Set<string>()
};

test('wireIdList / pickIdList: array + legacy CSV dual-read', () => {
	assert.deepEqual(wireIdList(['risk', 'bull', 'bull', '']), ['bull', 'risk']);
	assert.deepEqual(wireIdList('bull, bear, risk'), ['bear', 'bull', 'risk']);
	assert.deepEqual(pickIdList(['writer'], 'legacy'), ['writer']);
	assert.deepEqual(pickIdList(null, 'bull,bear'), ['bear', 'bull']);
	assert.deepEqual(pickIdList('', 'solo'), ['solo']);
	assert.deepEqual(pickIdList(undefined, undefined), []);
});

test('workflowNodeStatus: completed_steps → done', () => {
	assert.equal(
		workflowNodeStatus('a', {...base, completedSteps: new Set(['a'])}),
		'done'
	);
});

test('workflowNodeStatus: currentStepId → running (beats pending_extras)', () => {
	assert.equal(
		workflowNodeStatus('b', {
			...base,
			currentStepId: 'b',
			pendingExtras: new Set(['b'])
		}),
		'running'
	);
});

test('workflowNodeStatus: comma-separated currentStepId marks every id running', () => {
	const opts = {...base, currentStepId: 'bull, bear, risk'};
	assert.deepEqual([...currentStepIds(opts.currentStepId)].sort(), ['bear', 'bull', 'risk']);
	assert.equal(workflowNodeStatus('bull', opts), 'running');
	assert.equal(workflowNodeStatus('bear', opts), 'running');
	assert.equal(workflowNodeStatus('risk', opts), 'running');
	assert.equal(workflowNodeStatus('verify', opts), 'pending');
});

test('workflowNodeStatus: string[] currentStepIds marks every id running', () => {
	const opts = {...base, currentStepIds: ['bull', 'bear', 'risk']};
	assert.deepEqual([...currentStepIds(opts.currentStepIds)], ['bear', 'bull', 'risk']);
	assert.equal(workflowNodeStatus('bull', opts), 'running');
	assert.equal(workflowNodeStatus('bear', opts), 'running');
	assert.equal(workflowNodeStatus('risk', opts), 'running');
});

test('workflowNodeStatus: empty or blank currentStepId stays pending', () => {
	assert.equal(workflowNodeStatus('bull', {...base, currentStepId: ''}), 'pending');
	assert.equal(workflowNodeStatus('bull', {...base, currentStepId: '  ,  '}), 'pending');
	assert.deepEqual([...currentStepIds('bull,,bull,')], ['bull']);
});

test('workflowNodeStatus: completed_steps beats a stale parallel cursor', () => {
	const opts = {
		...base,
		currentStepId: 'bull,bear,risk',
		completedSteps: new Set(['bull'])
	};
	assert.equal(workflowNodeStatus('bull', opts), 'done');
	assert.equal(workflowNodeStatus('bear', opts), 'running');
	assert.equal(workflowNodeStatus('risk', opts), 'running');
});

test('workflowNodeStatus: blocked goal marks every current id blocked', () => {
	const opts = {...base, currentStepId: 'bull,bear', goalStatus: 'blocked'};
	assert.equal(workflowNodeStatus('bull', opts), 'blocked');
	assert.equal(workflowNodeStatus('bear', opts), 'blocked');
	assert.equal(workflowNodeStatus('verify', opts), 'pending');
});

test('currentStepNames: workflow order, not CSV order', () => {
	const steps = [
		{id: 'bull', use: '多方辩手'},
		{id: 'bear', use: '空方辩手'},
		{id: 'risk', use: '风控辩手'},
		{id: 'verify', use: '质检'}
	];
	assert.deepEqual(currentStepNames('risk,bull,bear', steps), [
		'多方辩手',
		'空方辩手',
		'风控辩手'
	]);
	assert.deepEqual(currentStepNames(['risk', 'bull', 'bear'], steps), [
		'多方辩手',
		'空方辩手',
		'风控辩手'
	]);
	assert.deepEqual(currentStepNames('ghost,bull', steps), ['多方辩手', 'ghost']);
	assert.deepEqual(currentStepNames('', steps), []);
});

test('workflowNodeStatus: pending_extras → reject-reopen', () => {
	assert.equal(
		workflowNodeStatus('c', {...base, pendingExtras: new Set(['c'])}),
		'reject-reopen'
	);
});

test('workflowNodeStatus: otherwise pending', () => {
	assert.equal(workflowNodeStatus('d', base), 'pending');
});

test('workflowNodeStatus: failed goal marks current as failed, rest skipped', () => {
	assert.equal(
		workflowNodeStatus('cur', {
			...base,
			currentStepId: 'cur',
			goalStatus: 'failed'
		}),
		'failed'
	);
	assert.equal(
		workflowNodeStatus('other', {...base, currentStepId: 'cur', goalStatus: 'failed'}),
		'skipped'
	);
});

test('workflowNodeStatus: blocked goal marks current as blocked (not running)', () => {
	assert.equal(
		workflowNodeStatus('cur', {
			...base,
			currentStepId: 'cur',
			goalStatus: 'blocked'
		}),
		'blocked'
	);
});
