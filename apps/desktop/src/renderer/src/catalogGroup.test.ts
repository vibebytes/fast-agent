import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogProvider, groupCatalogEntries} from './catalogGroup.js';
import type {ModelCatalogEntry} from './env.js';

function entry(partial: Partial<ModelCatalogEntry> & Pick<ModelCatalogEntry, 'id' | 'display'>): ModelCatalogEntry {
	return {
		aliases: [],
		current: false,
		...partial
	};
}

test('custom OpenAI wire groups under the Settings provider name', () => {
	const e = entry({
		id: 'custom-openai/auto',
		display: 'auto',
		providerId: 'custom-openai',
		providerName: 'vitebyte'
	});
	const ref = catalogProvider(e);
	assert.equal(ref.providerKey, 'custom-openai');
	assert.equal(ref.providerLabel, 'vitebyte');
	assert.equal(ref.cleanName, 'auto');
	assert.equal(ref.brand.name, 'vitebyte');
	assert.notEqual(ref.brand.name, 'OpenAI');

	const groups = groupCatalogEntries([
		e,
		entry({
			id: 'zhipu/glm-5.3',
			display: 'GLM-5.3',
			providerId: 'zhipu',
			providerName: '智谱 GLM'
		})
	]);
	assert.deepEqual(
		groups.map(g => g.providerLabel),
		['vitebyte', '智谱 GLM']
	);
});

test('id prefix is only a fallback when provider fields are missing', () => {
	const ref = catalogProvider(entry({id: 'deepseek/deepseek-v4-pro', display: 'DeepSeek V4 Pro'}));
	assert.equal(ref.providerKey, 'deepseek');
	assert.equal(ref.providerLabel, 'DeepSeek');
});

test('free rows from every provider collapse into one leading 免费模型 group', () => {
	const groups = groupCatalogEntries([
		entry({
			id: 'deepseek/deepseek-v4-pro',
			display: 'DeepSeek V4 Pro',
			providerId: 'deepseek',
			providerName: 'DeepSeek'
		}),
		entry({
			id: 'openrouter/x:free',
			display: 'X Free',
			providerId: 'openrouter',
			providerName: 'OpenRouter',
			free: true
		}),
		entry({
			id: 'kilo/k1',
			display: 'K1',
			providerId: 'kilo',
			providerName: 'Kilo',
			free: true
		})
	]);
	assert.deepEqual(
		groups.map(g => [g.providerKey, g.zone]),
		[
			['__free__', 'free'],
			['deepseek', undefined]
		]
	);
	assert.deepEqual(
		groups[0]?.items.map(i => i.entry.id),
		['openrouter/x:free', 'kilo/k1']
	);
	assert.equal(groups[0]?.providerLabel, '免费模型');
});

test('no free rows leaves the plain provider grouping untouched', () => {
	const groups = groupCatalogEntries([
		entry({id: 'deepseek/a', display: 'A', providerId: 'deepseek', providerName: 'DeepSeek'})
	]);
	assert.equal(groups.length, 1);
	assert.equal(groups[0]?.zone, undefined);
});
