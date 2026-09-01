import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {DshCallResult, DshSettingsOp} from '@fast-ide/session-view';
import {settingsCall, settingsHop} from './settings.js';

test('settingsHop maps every settings-page op to one DSH method', () => {
	const hops: Array<[DshSettingsOp, ReturnType<typeof settingsHop>]> = [
		[{op: 'describe'}, {method: 'settings.describe', payload: {}}],
		[
			{op: 'update', ns: 'locale', patch: {preference: 'en'}, expectedRevision: 3},
			{method: 'settings.update', payload: {ns: 'locale', patch: {preference: 'en'}, expectedRevision: 3}}
		],
		[
			{op: 'mutate', ns: 'permission', ops: [{op: 'set', path: ['defaultPreset'], value: 'read-only'}]},
			{
				method: 'settings.mutate',
				payload: {ns: 'permission', ops: [{op: 'set', path: ['defaultPreset'], value: 'read-only'}]}
			}
		],
		[
			{op: 'replace', ns: 'locale', section: {preference: 'zh'}},
			{method: 'settings.replace', payload: {ns: 'locale', section: {preference: 'zh'}}}
		],
		[{op: 'openDocument'}, {method: 'settings.openDocument', payload: {}}],
		[{op: 'credentialsDescribe', refs: ['DEEPSEEK_API_KEY']}, {method: 'credentials.describe', payload: {refs: ['DEEPSEEK_API_KEY']}}],
		[{op: 'credentialsSet', ref: 'k', value: 'secret'}, {method: 'credentials.set', payload: {ref: 'k', value: 'secret'}}],
		[{op: 'credentialsUnset', ref: 'k'}, {method: 'credentials.unset', payload: {ref: 'k'}}],
		[{op: 'llmModels'}, {method: 'llm.models', payload: {}}],
		[{op: 'llmProviders'}, {method: 'llm.providers', payload: {}}],
		[
			{op: 'llmDiscoverModels', input: {provider: 'deepseek', baseURL: 'https://api'}},
			{method: 'llm.discoverModels', payload: {provider: 'deepseek', baseURL: 'https://api'}}
		],
		[{op: 'agentPresetList'}, {method: 'agentPreset.list', payload: {}}],
		[
			{op: 'agentPresetSelect', sessionId: 's1', agentPreset: 'standard'},
			{
				method: 'agentPreset.select',
				payload: {sessionId: 's1', agentPreset: 'standard'},
				sessionId: 's1'
			}
		],
		[{op: 'agentPresetRead', agentPreset: 'standard'}, {method: 'agentPreset.read', payload: {agentPreset: 'standard'}}],
		[
			{op: 'agentPresetCopy', from: 'standard', agentPreset: 'mine', name: '我的模式'},
			{method: 'agentPreset.copy', payload: {from: 'standard', agentPreset: 'mine', name: '我的模式'}}
		],
		[
			{op: 'agentPresetOpenDocument', agentPreset: 'mine'},
			{method: 'agentPreset.openDocument', payload: {agentPreset: 'mine'}}
		],
		[{op: 'agentPresetRemove', agentPreset: 'mine'}, {method: 'agentPreset.remove', payload: {agentPreset: 'mine'}}],
		[{op: 'sessionList'}, {method: 'session.list', payload: {}}],
		[{op: 'pluginInventoryList'}, {method: 'pluginInventory.list', payload: {}}]
	];
	for (const [op, expected] of hops) {
		assert.deepEqual(settingsHop(op), expected, op.op);
	}
});

test('settingsHop omits a blank copy name so the host falls back to the id', () => {
	assert.deepEqual(settingsHop({op: 'agentPresetCopy', from: 'standard', agentPreset: 'my-copy', name: '   '}), {
		method: 'agentPreset.copy',
		payload: {from: 'standard', agentPreset: 'my-copy'}
	});
	assert.deepEqual(settingsHop({op: 'agentPresetCopy', from: 'standard', agentPreset: 'my-copy'}), {
		method: 'agentPreset.copy',
		payload: {from: 'standard', agentPreset: 'my-copy'}
	});
});

test('settingsHop carries sessionId only on agentPreset.select', () => {
	assert.equal(settingsHop({op: 'agentPresetList'}).sessionId, undefined);
	assert.equal(
		settingsHop({op: 'agentPresetSelect', sessionId: 's1', agentPreset: 'standard'}).sessionId,
		's1'
	);
});

test('settingsCall forwards the hop to the unary transport', async () => {
	const hops: Array<{method: string; payload?: Record<string, unknown>; sessionId?: string}> = [];
	const call = async (method: string, payload?: Record<string, unknown>, sessionId?: string): Promise<DshCallResult> => {
		hops.push({method, payload, sessionId});
		return {ok: true, method, value: {ok: true}};
	};
	const result = await settingsCall(call, {
		op: 'agentPresetSelect',
		sessionId: 's1',
		agentPreset: 'standard'
	});
	assert.equal(result.ok, true);
	assert.deepEqual(hops, [
		{
			method: 'agentPreset.select',
			payload: {sessionId: 's1', agentPreset: 'standard'},
			sessionId: 's1'
		}
	]);
});
