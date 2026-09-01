import assert from 'node:assert/strict';
import test from 'node:test';
import {catalogRows, joinProviders, keyFailure, modelIssue, ROUTE_PATTERN} from './providerJoin';
import {protocolChoices, type SettingsDescribe} from './settings';

const describe: SettingsDescribe = {
	writable: true,
	hasDocument: true,
	namespaces: [
		{
			ns: 'llm-deepseek',
			schema: {},
			value: {apiKeyEnv: 'DEEPSEEK_API_KEY', models: []},
			base: {apiKeyEnv: 'DEEPSEEK_API_KEY'},
			revision: 0
		},
		{
			ns: 'llm-pi-ai',
			schema: {},
			value: {providers: {}},
			base: {providers: {}},
			user: undefined,
			revision: 0
		}
	]
};

test('joinProviders only marks whole-section or stored profiles as configured', () => {
	const rows = joinProviders(
		[
			{
				provider: 'deepseek-official',
				displayName: 'DeepSeek',
				settingsNs: 'llm-deepseek',
				settingsPath: [],
				active: true
			},
			{
				provider: 'amazon-bedrock',
				displayName: 'amazon-bedrock',
				settingsNs: 'llm-pi-ai',
				settingsPath: ['providers', 'amazon-bedrock'],
				active: false,
				declared: false
			}
		],
		describe,
		{DEEPSEEK_API_KEY: {configured: true, writable: true}}
	);
	assert.equal(rows[0]?.configured, true);
	assert.equal(rows[0]?.removable, false);
	assert.equal(rows[0]?.apiKeyEnv, 'DEEPSEEK_API_KEY');
	assert.equal(rows[0]?.credential?.configured, true);
	assert.equal(rows[1]?.configured, false);
	assert.equal(rows[1]?.removable, false);
});

test('joinProviders treats a user-only pi-ai profile as removable', () => {
	const rows = joinProviders(
		[
			{
				provider: 'acme-gateway',
				displayName: 'Acme',
				settingsNs: 'llm-pi-ai',
				settingsPath: ['providers', 'acme-gateway'],
				active: true,
				declared: true
			}
		],
		{
			...describe,
			namespaces: describe.namespaces.map(n =>
				n.ns === 'llm-pi-ai'
					? {
							...n,
							value: {providers: {['acme-gateway']: {baseURL: 'https://x'}}},
							user: {providers: {['acme-gateway']: {baseURL: 'https://x'}}},
							base: {providers: {}}
						}
					: n
			)
		},
		{}
	);
	assert.equal(rows[0]?.configured, true);
	assert.equal(rows[0]?.removable, true);
});

test('protocolChoices reads llm-pi-ai providers.*.api union', () => {
	assert.deepEqual(
		protocolChoices({
			uid: 3,
			refs: {
				1: {type: 'const', value: 'openai-completions'},
				2: {type: 'const', value: 'anthropic-messages'},
				4: {type: 'union', list: [1, 2]},
				5: {type: 'object', dict: {api: 4, baseURL: 1}},
				6: {type: 'dict', inner: 5},
				3: {type: 'object', dict: {providers: 6}}
			}
		}),
		['openai-completions', 'anthropic-messages']
	);
});

test('catalogRows keeps a blank add-model row that modelRows would drop', () => {
	const rows = catalogRows([
		{id: 'deepseek-v4-flash', name: 'Flash'},
		{id: '', name: ''}
	]);
	assert.equal(rows.length, 2);
	assert.equal(rows[1]?.id, '');
	assert.deepEqual(modelIssue(rows), {index: 1, key: 'modelIdRequired'});
});

test('custom route and key gates match DSH', () => {
	assert.equal(ROUTE_PATTERN.test('acme-gateway'), true);
	assert.equal(ROUTE_PATTERN.test('1bad'), false);
	assert.equal(keyFailure(''), undefined);
	assert.equal(keyFailure('   '), 'keyBlank');
	assert.equal(keyFailure('NAME=value'), 'keyIllegal');
});
