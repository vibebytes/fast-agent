import test from 'node:test';
import assert from 'node:assert/strict';
import {
	catalogFromProviders,
	filterModelCatalog,
	parseModelCatalog,
	resolveComposerChrome
} from './modelCatalog.js';

test('parseModelCatalog reads starred current and aliases from Engine /model text', () => {
	const message = [
		'Current model: default -> deepseek-reasoner',
		'',
		'* default (def)',
		'  gpt-4o',
		'  claude-sonnet (sonnet, claude) | thinking=1 efforts=low,medium default=medium',
		'',
		'Usage: /model <name|alias>'
	].join('\n');

	const entries = parseModelCatalog(message);
	assert.equal(entries.length, 3);
	// Lines without the capability suffix parse to thinking=false / no efforts.
	assert.deepEqual(entries[0], {
		id: 'default',
		display: 'default',
		aliases: ['def'],
		current: true,
		supportsThinking: false,
		supportedEfforts: []
	});
	assert.equal(entries[1]?.id, 'gpt-4o');
	assert.equal(entries[1]?.current, false);
	assert.deepEqual(entries[2]?.aliases, ['sonnet', 'claude']);
	// Capability suffix (thinking/efforts/default) rides on the entry.
	assert.equal(entries[2]?.supportsThinking, true);
	assert.deepEqual(entries[2]?.supportedEfforts, ['low', 'medium']);
	assert.equal(entries[2]?.defaultEffort, 'medium');
});

test('filterModelCatalog matches id display and aliases', () => {
	const entries = parseModelCatalog('* default (def)\n  gpt-4o\n');
	assert.equal(filterModelCatalog(entries, 'def').length, 1);
	assert.equal(filterModelCatalog(entries, 'gpt').length, 1);
	assert.equal(filterModelCatalog(entries, 'zzz').length, 0);
});

test('parseModelCatalog drops internal default alias from menu aliases', () => {
	const entries = parseModelCatalog(
		'* openrouter/nvidia/nemotron-3-ultra-550b-a55b:free (default, nemotron-3-ultra-550b-a55b-free) | thinking=0 efforts= default=\n'
	);
	assert.equal(entries.length, 1);
	assert.equal(entries[0]?.display, 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free');
	assert.deepEqual(entries[0]?.aliases, ['nemotron-3-ultra-550b-a55b-free']);
});

test('parseModelCatalog marks current from Current model header when star missing', () => {
	const message = [
		'Current model: openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
		'',
		'  openrouter/nvidia/nemotron-3-ultra-550b-a55b:free (nemotron-3-ultra-550b-a55b-free)',
		'  gpt-4o',
		'',
		'Usage: /model <name|alias>'
	].join('\n');
	const entries = parseModelCatalog(message);
	assert.equal(entries.length, 2);
	assert.equal(entries[0]?.current, true);
	assert.equal(entries[0]?.display, 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free');
	assert.equal(entries[1]?.current, false);
});

test('catalogFromProviders keeps only enabled provider × enabled model', () => {
	const entries = catalogFromProviders(
		[
			{
				id: 'deepseek',
				kind: 'api',
				vendor: 'deepseek',
				name: 'DeepSeek',
				modelCount: 2,
				enabledModelCount: 2,
				enabled: true,
				models: [
					{
						modelId: 'deepseek-v4-pro',
						displayName: 'DeepSeek V4 Pro',
						enabled: true,
						source: 'catalog',
						supportsThinking: true,
						supportedEfforts: ['low', 'xhigh']
					},
					{
						modelId: 'hidden',
						displayName: 'Hidden',
						enabled: false,
						source: 'catalog'
					}
				]
			},
			{
				id: 'anthropic',
				kind: 'api',
				vendor: 'anthropic',
				name: 'Anthropic',
				modelCount: 1,
				enabledModelCount: 1,
				enabled: false,
				models: [
					{
						modelId: 'claude-opus-4-5',
						displayName: 'Claude Opus 4.5',
						enabled: true,
						source: 'catalog'
					}
				]
			},
			{
				id: 'openrouter',
				kind: 'api',
				vendor: 'openrouter',
				name: 'OpenRouter',
				modelCount: 1,
				enabledModelCount: 1,
				enabled: true,
				models: [
					{
						modelId: 'openai/gpt-5.6-terra',
						displayName: 'GPT-5.6 Terra',
						enabled: true,
						source: 'catalog'
					}
				]
			}
		],
		'deepseek/deepseek-v4-pro'
	);
	assert.equal(entries.length, 2);
	assert.equal(entries[0]?.id, 'deepseek/deepseek-v4-pro');
	assert.equal(entries[0]?.display, 'DeepSeek V4 Pro');
	assert.equal(entries[0]?.current, true);
	assert.equal(entries[1]?.id, 'openrouter/openai/gpt-5.6-terra');
	assert.equal(entries[1]?.display, 'GPT-5.6 Terra');
	assert.equal(
		entries.some(e => e.id.includes('claude')),
		false
	);
});

test('resolveComposerChrome keeps a catalog pick and snaps yaml default to first enabled', () => {
	const entries = catalogFromProviders(
		[
			{
				id: 'deepseek',
				kind: 'api',
				vendor: 'deepseek',
				name: 'DeepSeek',
				modelCount: 2,
				enabledModelCount: 2,
				enabled: true,
				models: [
					{
						modelId: 'deepseek-v4-flash',
						displayName: 'DeepSeek V4 Flash',
						enabled: true,
						source: 'catalog'
					},
					{
						modelId: 'deepseek-v4-pro',
						displayName: 'DeepSeek V4 Pro',
						enabled: true,
						source: 'catalog'
					}
				]
			}
		],
		'deepseek/deepseek-v4-pro'
	);
	assert.equal(
		resolveComposerChrome(entries, 'deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro')?.id,
		'deepseek/deepseek-v4-pro'
	);
	assert.equal(
		resolveComposerChrome(
			entries,
			'default',
			'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free'
		)?.id,
		'deepseek/deepseek-v4-pro',
		'yaml stub is not in the DB catalog — use marked current, else first'
	);
});
