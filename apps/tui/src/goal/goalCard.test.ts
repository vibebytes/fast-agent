import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {buildPatchJson, editFields, fieldValue, parseMembers} from './goalCard.js';
import type {GoalCardState} from '../state/model.js';

const card: GoalCardState = {
	goalId: 'g1',
	phase: 'awaiting_confirm',
	status: 'awaiting_confirm',
	statement: 'ship widget',
	acceptance: 'tests green',
	workflowJson: '{"kind":"pipeline","nodes":[]}',
	budgetJson: '{"max_rejects":3}',
	membersJson: '[{"name":"dev","role":"executor","model":"deepseek","max_turns":50},{"name":"qa","role":"verifier"}]'
};

describe('goalCard', () => {
	it('parses member drafts', () => {
		const members = parseMembers(card.membersJson);
		assert.equal(members.length, 2);
		assert.equal(members[0]?.model, 'deepseek');
		assert.equal(members[0]?.maxTurns, 50);
	});

	it('edit fields cover full draft scope (statement/acceptance/workflow/budget + member params)', () => {
		const fields = editFields(card);
		const labels = fields.map(f => f.label);
		assert.ok(labels.includes('目标'));
		assert.ok(labels.includes('workflow(JSON)'));
		assert.ok(labels.includes('budget(JSON)'));
		assert.ok(labels.includes('dev·model'));
		assert.ok(labels.includes('qa·isolation'));
	});

	it('fieldValue prefers local edits over the card snapshot', () => {
		const field = editFields(card)[0]!;
		assert.equal(fieldValue(card, field, {}), 'ship widget');
		assert.equal(fieldValue(card, field, {statement: 'edited'}), 'edited');
	});

	it('buildPatchJson emits full GoalPatch payload from edits', () => {
		const {patchJson, error} = buildPatchJson({
			statement: 'new statement',
			budget: '{"max_rejects":5}',
			'member:dev:model': 'gpt',
			'member:dev:max_turns': '99'
		});
		assert.equal(error, undefined);
		const parsed = JSON.parse(patchJson!);
		assert.equal(parsed.statement, 'new statement');
		assert.equal(parsed.budget_json.max_rejects, 5);
		assert.deepEqual(parsed.members, [{name: 'dev', model: 'gpt', max_turns: 99}]);
	});

	it('buildPatchJson surfaces malformed JSON and non-numeric max_turns', () => {
		assert.ok(buildPatchJson({workflow: '{oops'}).error);
		assert.ok(buildPatchJson({'member:dev:max_turns': 'abc'}).error);
	});

	it('no edits → no patch payload (plain confirm)', () => {
		assert.deepEqual(buildPatchJson({}), {});
	});
});
