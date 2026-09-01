import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {DshCallResult} from '@fast-ide/session-view';
import {asModels, getDshModels, selectDshModel} from './models.js';

const groups = [
	{
		id: 'deepseek',
		name: 'DeepSeek',
		models: [{id: 'deepseek-chat', name: 'DeepSeek Chat'}]
	}
];

test('asModels keeps groups and failures when current is routable', () => {
	const parsed = asModels({
		current: {provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high'},
		routable: true,
		groups,
		failures: [{id: 'broken', name: 'Broken', message: 'down'}]
	});
	assert.deepEqual(parsed, {
		current: {provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high'},
		routable: true,
		groups,
		failures: [{id: 'broken', name: 'Broken', message: 'down'}]
	});
});

test('asModels rejects a missing or incomplete current selection', () => {
	assert.equal(asModels(null), null);
	assert.equal(asModels({routable: true, groups}), null);
	assert.equal(asModels({current: {provider: 'deepseek'}, groups}), null);
	assert.equal(asModels({current: {model: 'deepseek-chat'}, groups}), null);
});

test('asModels treats missing groups as empty and routable only when true', () => {
	const parsed = asModels({current: {provider: 'deepseek', model: 'chat'}});
	assert.deepEqual(parsed, {
		current: {provider: 'deepseek', model: 'chat'},
		routable: false,
		groups: [],
		failures: []
	});
});

test('getDshModels parses session.models and keeps groups', async () => {
	const hops: Array<{method: string; payload?: Record<string, unknown>; sessionId?: string}> = [];
	const result = await getDshModels(async (method, payload, sessionId) => {
		hops.push({method, payload, sessionId});
		return {
			ok: true,
			method,
			value: {current: {provider: 'deepseek', model: 'chat'}, routable: true, groups}
		};
	}, 's1');
	assert.deepEqual(hops, [{method: 'session.models', payload: {sessionId: 's1'}, sessionId: 's1'}]);
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.routable, true);
		assert.deepEqual(result.value.groups, groups);
	}
});

test('getDshModels omits sessionId from the payload when none is given', async () => {
	const hops: Array<{payload?: Record<string, unknown>}> = [];
	await getDshModels(async (_method, payload) => {
		hops.push({payload});
		return {ok: false, error: {code: 'unavailable'}};
	});
	assert.deepEqual(hops, [{payload: {}}]);
});

test('getDshModels passes engine errors through and rejects a bad shape', async () => {
	const down = await getDshModels(async () => ({ok: false, error: {code: 'unavailable', message: 'down'}}));
	assert.deepEqual(down, {ok: false, error: {code: 'unavailable', message: 'down'}});

	const bad = await getDshModels(async method => ({ok: true, method, value: {groups}}));
	assert.deepEqual(bad, {ok: false, error: {code: 'internal', message: 'session.models shape'}});
});

test('selectDshModel wraps session.selectModel and drops a blank effort', async () => {
	const hops: Array<{method: string; payload?: Record<string, unknown>; sessionId?: string}> = [];
	const call = async (method: string, payload?: Record<string, unknown>, sessionId?: string): Promise<DshCallResult> => {
		hops.push({method, payload, sessionId});
		return {ok: true, method, value: {}};
	};
	await selectDshModel(call, {sessionId: 's1', provider: 'deepseek', model: 'chat', reasoningEffort: 'high'});
	await selectDshModel(call, {provider: 'deepseek', model: 'chat', reasoningEffort: ''});
	assert.deepEqual(hops, [
		{
			method: 'session.selectModel',
			payload: {sessionId: 's1', provider: 'deepseek', model: 'chat', reasoningEffort: 'high'},
			sessionId: 's1'
		},
		{
			method: 'session.selectModel',
			payload: {provider: 'deepseek', model: 'chat'},
			sessionId: undefined
		}
	]);
});
