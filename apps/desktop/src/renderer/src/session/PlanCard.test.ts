import assert from 'node:assert/strict';
import test from 'node:test';
import {buildPlan} from './PlanCard.js';

test('buildPlan issues SetMode(agent) then buildPlan host API', async () => {
	const calls: Array<{op: string; arg: string}> = [];
	const ok = await buildPlan('plan-xyz', 'My Plan', {
		setRunMode: async mode => {
			calls.push({op: 'setRunMode', arg: mode});
			return true;
		},
		buildPlan: async (planId, name) => {
			calls.push({op: 'buildPlan', arg: `${planId}:${name ?? ''}`});
			return {ok: true};
		}
	});
	assert.equal(ok, true);
	assert.deepEqual(calls, [
		{op: 'setRunMode', arg: 'agent'},
		{op: 'buildPlan', arg: 'plan-xyz:My Plan'}
	]);
});

test('buildPlan aborts Submit when SetMode fails', async () => {
	let sent = false;
	const ok = await buildPlan('plan-xyz', '', {
		setRunMode: async () => false,
		buildPlan: async () => {
			sent = true;
			return {ok: true};
		}
	});
	assert.equal(ok, false);
	assert.equal(sent, false);
});
