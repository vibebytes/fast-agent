import test from 'node:test';
import assert from 'node:assert/strict';
import {getProviderBrand, getModelCapabilityBadges} from './modelBrand.js';
import type {ModelCatalogEntry} from './env.js';

test('getProviderBrand recognizes major AI model providers', () => {
	const deepseek = getProviderBrand('deepseek');
	assert.equal(deepseek.name, 'DeepSeek');
	assert.equal(deepseek.shortName, 'DS');

	const openai = getProviderBrand('openai');
	assert.equal(openai.name, 'OpenAI');
	assert.equal(openai.shortName, 'OA');

	const anthropic = getProviderBrand('anthropic');
	assert.equal(anthropic.name, 'Anthropic');
	assert.equal(anthropic.shortName, 'CL');

	const zhipu = getProviderBrand('zhipu');
	assert.equal(zhipu.name, '智谱 GLM');
	assert.equal(zhipu.shortName, 'GLM');

	const openrouter = getProviderBrand('openrouter');
	assert.equal(openrouter.name, 'OpenRouter');
	assert.equal(openrouter.shortName, 'OR');

	const fallback = getProviderBrand('custom-engine');
	assert.equal(fallback.name, 'Custom-engine');
	assert.equal(fallback.shortName, 'CU');
});

test('getModelCapabilityBadges identifies thinking, fast, and flagship capabilities', () => {
	const thinkingEntry: ModelCatalogEntry = {
		id: 'deepseek/deepseek-r1',
		display: 'DeepSeek R1',
		aliases: [],
		current: true,
		supportsThinking: true
	};
	const thinkingBadges = getModelCapabilityBadges(thinkingEntry);
	assert.ok(thinkingBadges.some(b => b.key === 'thinking'));

	const fastEntry: ModelCatalogEntry = {
		id: 'openai/gpt-4o-mini',
		display: 'GPT-4o Mini',
		aliases: [],
		current: false
	};
	const fastBadges = getModelCapabilityBadges(fastEntry);
	assert.ok(fastBadges.some(b => b.key === 'fast'));

	const proEntry: ModelCatalogEntry = {
		id: 'anthropic/claude-3-5-sonnet-pro',
		display: 'Claude 3.5 Sonnet Pro',
		aliases: [],
		current: false
	};
	const proBadges = getModelCapabilityBadges(proEntry);
	assert.ok(proBadges.some(b => b.key === 'flagship'));
});
