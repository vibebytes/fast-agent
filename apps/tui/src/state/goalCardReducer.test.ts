import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {initialState} from './model.js';
import {reducer} from './reducer.js';
import type {BridgeEvent} from '../rpc/protocol.js';

function goalUpdated(overrides: Partial<Extract<BridgeEvent, {type: 'goal_updated'}>> = {}): BridgeEvent {
	return {
		type: 'goal_updated',
		goalId: 'g1',
		phase: 'awaiting_confirm',
		status: 'awaiting_confirm',
		statement: 'ship widget',
		acceptance: 'tests green',
		membersJson: '[{"name":"dev","role":"executor"}]',
		...overrides
	} as BridgeEvent;
}

describe('goal card reducer (②′ card lifecycle from goal_updated only)', () => {
	it('awaiting_confirm event opens the confirm card', () => {
		const s = reducer(initialState, {type: 'engine_event', event: goalUpdated()});
		assert.equal(s.goalCard?.phase, 'awaiting_confirm');
		assert.equal(s.goalCard?.goalId, 'g1');
		assert.equal(s.goalCard?.statement, 'ship widget');
	});

	it('dual-reads legacy CSV currentStepId into currentStepIds', () => {
		const s = reducer(
			initialState,
			{
				type: 'engine_event',
				event: goalUpdated({
					phase: 'started',
					status: 'running',
					currentStepId: 'bull,bear,risk',
					activeRunId: 'r2,r1'
				})
			}
		);
		assert.deepEqual(s.goalCard?.currentStepIds, ['bear', 'bull', 'risk']);
		assert.deepEqual(s.goalCard?.activeRunIds, ['r1', 'r2']);
	});

	it('started/escalated/finished update the same card', () => {
		let s = reducer(initialState, {type: 'engine_event', event: goalUpdated()});
		s = reducer(s, {type: 'engine_event', event: goalUpdated({phase: 'started', status: 'running'})});
		assert.equal(s.goalCard?.phase, 'started');
		s = reducer(s, {
			type: 'engine_event',
			event: goalUpdated({phase: 'escalated', status: 'blocked', escalateActions: ['Resume', 'Fail'], reason: 'budget'})
		});
		assert.equal(s.goalCard?.phase, 'escalated');
		assert.deepEqual(s.goalCard?.escalateActions, ['Resume', 'Fail']);
		s = reducer(s, {
			type: 'engine_event',
			event: goalUpdated({phase: 'finished', status: 'passed', resultSummary: 'Goal passed'})
		});
		assert.equal(s.goalCard?.phase, 'finished');
		assert.equal(s.goalCard?.resultSummary, 'Goal passed');
	});

	it('accepted ConfirmGoal command_result keeps the card as started', () => {
		let s = reducer(initialState, {type: 'engine_event', event: goalUpdated()});
		s = reducer(s, {
			type: 'engine_event',
			event: {
				type: 'command_result',
				name: 'ConfirmGoal',
				message: 'confirmed+started g1',
				status: 'accepted',
				goal: {id: 'g1', status: 'running', statement: 'ship widget'}
			} as BridgeEvent
		});
		assert.equal(s.goalCard?.phase, 'started');
		assert.equal(s.goalCard?.status, 'running');
		assert.equal(s.goalCard?.goalId, 'g1');
	});

	it('error ConfirmGoal keeps the card so the user can retry', () => {
		let s = reducer(initialState, {type: 'engine_event', event: goalUpdated()});
		s = reducer(s, {
			type: 'engine_event',
			event: {type: 'command_result', name: 'ConfirmGoal', message: 'boom', status: 'error'} as BridgeEvent
		});
		assert.equal(s.goalCard?.phase, 'awaiting_confirm');
	});

	it('dismiss_goal_card clears card and focus', () => {
		let s = reducer(initialState, {type: 'engine_event', event: goalUpdated({phase: 'finished', status: 'passed'})});
		s = reducer(s, {type: 'toggle_goal_card_focus'});
		assert.equal(s.goalCardFocused, true);
		s = reducer(s, {type: 'dismiss_goal_card'});
		assert.equal(s.goalCard, undefined);
		assert.equal(s.goalCardFocused, false);
	});

	it('a started push for a different goal does not clobber a live confirm card', () => {
		let s = reducer(initialState, {type: 'engine_event', event: goalUpdated()});
		s = reducer(s, {type: 'engine_event', event: goalUpdated({goalId: 'g2', phase: 'started', status: 'running'})});
		assert.equal(s.goalCard?.goalId, 'g1');
		assert.equal(s.goalCard?.phase, 'awaiting_confirm');
	});

	it('paused push flips the card to the paused banner (review fix: pause was invisible)', () => {
		let s = reducer(initialState, {type: 'engine_event', event: goalUpdated({phase: 'started', status: 'running'})});
		s = reducer(s, {type: 'engine_event', event: goalUpdated({phase: 'paused', status: 'paused'})});
		assert.equal(s.goalCard?.phase, 'paused');
		assert.equal(s.goalCard?.status, 'paused');
	});

	it('accepted PatchGoal result refreshes the confirm card draft (review fix: stale card)', () => {
		let s = reducer(initialState, {type: 'engine_event', event: goalUpdated()});
		s = reducer(s, {
			type: 'engine_event',
			event: {
				type: 'command_result',
				name: 'PatchGoal',
				message: 'patched g1',
				status: 'accepted',
				goal: {
					id: 'g1',
					status: 'awaiting_confirm',
					statement: 'ship widget v2',
					acceptance: 'stricter acceptance',
					budgetJson: '{"max_rejects":5}',
					membersJson: '[{"name":"dev","role":"executor","model":"gpt"}]'
				}
			} as BridgeEvent
		});
		assert.equal(s.goalCard?.phase, 'awaiting_confirm');
		assert.equal(s.goalCard?.statement, 'ship widget v2');
		assert.equal(s.goalCard?.acceptance, 'stricter acceptance');
		assert.equal(s.goalCard?.budgetJson, '{"max_rejects":5}');
		assert.ok(s.goalCard?.membersJson?.includes('"model":"gpt"'));
	});

	it('PatchGoal result for another goal id leaves the card untouched', () => {
		let s = reducer(initialState, {type: 'engine_event', event: goalUpdated()});
		s = reducer(s, {
			type: 'engine_event',
			event: {
				type: 'command_result',
				name: 'PatchGoal',
				message: 'patched g9',
				status: 'accepted',
				goal: {id: 'g9', status: 'awaiting_confirm', statement: 'other'}
			} as BridgeEvent
		});
		assert.equal(s.goalCard?.statement, 'ship widget');
	});
});
