import assert from 'node:assert/strict';
import test from 'node:test';
import {goalCardKey} from './goalCardKey';
import type {GoalCardView} from '../env';

const card = (goalId: string): GoalCardView => ({goalId, phase: 'awaiting_confirm', status: 'awaiting_confirm'});

test('goalCardKey resets panel state across tasks and goals (review fix)', () => {
	assert.notEqual(goalCardKey('task-1', card('g1')), goalCardKey('task-2', card('g1')));
	assert.notEqual(goalCardKey('task-1', card('g1')), goalCardKey('task-1', card('g2')));
	assert.equal(goalCardKey('task-1', card('g1')), goalCardKey('task-1', card('g1')));
	assert.equal(goalCardKey(null, card('g1')), 'none:g1');
});
