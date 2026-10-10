import assert from 'node:assert/strict';
import test from 'node:test';
import type {ConfigurableTool} from '@fast-ide/session-view';
import {visiblePluginTabs} from './pluginTabs.js';
import {draftsFrom, modelRefOptions, submitToolForm, toolsSurface} from './toolForm.js';

function tool(patch: Partial<ConfigurableTool> = {}): ConfigurableTool {
	return {
		name: 'deepseek_search',
		titleKey: 'settings.plugins.tools.deepseek.title',
		summaryKey: 'settings.plugins.tools.deepseek.summary',
		status: 'active',
		fields: [
			{key: 'apiKey', type: 'secret', required: true},
			{key: 'region', type: 'text', required: false},
			{key: 'limit', type: 'number', required: false},
			{key: 'fresh', type: 'toggle', required: false},
			{key: 'mode', type: 'choice', required: false, options: ['web', 'news']}
		],
		values: {region: 'us', limit: 8, fresh: true, mode: 'web'},
		secrets: {apiKey: {present: true, last4: '1234'}},
		...patch
	};
}

test('plugin tabs place tools after skills and keep cli hidden', () => {
	assert.deepEqual(visiblePluginTabs(), ['skills', 'tools', 'mcp', 'extensions']);
});

test('engine not ready is the disabled empty state', () => {
	assert.equal(toolsSurface({engineReady: false, status: 'disabled', tools: []}), 'disabled');
	assert.equal(toolsSurface({engineReady: false, status: 'ready', tools: [tool()]}), 'disabled');
	assert.equal(toolsSurface({engineReady: true, status: 'ready', tools: []}), 'empty');
	assert.equal(toolsSurface({engineReady: true, status: 'ready', tools: [tool()]}), 'list');
});

test('form drafts come from stored values and leave the secret blank', () => {
	const drafts = draftsFrom(tool());
	assert.equal(drafts.region, 'us');
	assert.equal(drafts.limit, '8');
	assert.equal(drafts.fresh, 'true');
	assert.equal(drafts.mode, 'web');
	assert.equal(drafts.apiKey, undefined);
});

test('saving an open form keeps stored non-secret values and does not resend the secret', () => {
	const row = tool();
	const submitted = submitToolForm(row, draftsFrom(row), {});
	assert.equal(submitted.kind, 'save');
	if (submitted.kind === 'save') {
		assert.equal(submitted.input.enabled, true);
		assert.deepEqual(submitted.input.values, {region: 'us', limit: 8, fresh: true, mode: 'web'});
		assert.deepEqual(submitted.input.secrets, {});
		assert.deepEqual(submitted.input.clearSecrets, []);
	}
});

test('an empty required secret with no last4 does not submit enable', () => {
	const row = tool({status: 'paused', secrets: {apiKey: {present: false, last4: null}}, values: {}});
	const submitted = submitToolForm(row, {}, {});
	assert.equal(submitted.kind, 'hold');
});

test('clearing a required secret saves the clear without requesting enable', () => {
	const submitted = submitToolForm(tool(), draftsFrom(tool()), {apiKey: true});
	assert.equal(submitted.kind, 'save');
	if (submitted.kind === 'save') {
		assert.equal(submitted.input.enabled, false);
		assert.deepEqual(submitted.input.clearSecrets, ['apiKey']);
		assert.deepEqual(submitted.input.secrets, {});
		assert.deepEqual(submitted.input.values, {region: 'us', limit: 8, fresh: true, mode: 'web'});
	}
});

test('a replacement secret after clear is sent and enable stays requested', () => {
	const drafts = {...draftsFrom(tool()), apiKey: 'sk-new-9999'};
	const submitted = submitToolForm(tool(), drafts, {apiKey: true});
	assert.equal(submitted.kind, 'save');
	if (submitted.kind === 'save') {
		assert.equal(submitted.input.enabled, true);
		assert.deepEqual(submitted.input.secrets, {apiKey: 'sk-new-9999'});
		assert.deepEqual(submitted.input.clearSecrets, []);
	}
});

function imageTool(patch: Partial<ConfigurableTool> = {}): ConfigurableTool {
	return tool({
		name: 'generate_image',
		fields: [
			{key: 'apiKey', type: 'secret', required: true},
			{
				key: 'model',
				type: 'model-ref',
				required: true,
				candidates: [
					{key: 'openrouter/openai/gpt-image-2', display: 'GPT Image 2', platform: 'openrouter', tokenPresent: true},
					{key: 'dashscope/wanx-v1', display: 'Wanx v1', platform: 'dashscope', tokenPresent: false}
				]
			},
			{key: 'size', type: 'choice', required: false, options: ['1024x1024', '1536x1024']},
			{key: 'sessionScope', type: 'choice', required: false, options: ['main_only', 'all_sessions']}
		],
		values: {model: 'openrouter/openai/gpt-image-2', size: '1024x1024', sessionScope: 'main_only'},
		secrets: {apiKey: {present: true, last4: '1234'}},
		...patch
	});
}

test('model-ref drafts carry the stored model key', () => {
	assert.equal(draftsFrom(imageTool()).model, 'openrouter/openai/gpt-image-2');
	assert.equal(draftsFrom(imageTool({values: {}})).model, '');
});

test('model-ref select offers candidates and disables rows without a token', () => {
	const options = modelRefOptions(imageTool().fields.find((field) => field.key === 'model')!);
	assert.deepEqual(
		options.map((option) => option.value),
		['openrouter/openai/gpt-image-2', 'dashscope/wanx-v1']
	);
	assert.equal(options[0].disabled, false);
	assert.equal(options[1].disabled, true);
	assert.match(options[1].label, /Wanx v1/);
});

test('submitting the image form keeps the model value and omits sessionScope from values', () => {
	const submitted = submitToolForm(imageTool(), draftsFrom(imageTool()), {});
	assert.equal(submitted.kind, 'save');
	if (submitted.kind === 'save') {
		assert.deepEqual(submitted.input.values, {model: 'openrouter/openai/gpt-image-2', size: '1024x1024'});
		assert.equal(submitted.input.enabled, true);
	}
});

test('a blank required model-ref holds the save', () => {
	const drafts = {...draftsFrom(imageTool()), model: ''};
	const submitted = submitToolForm(imageTool(), drafts, {});
	assert.equal(submitted.kind, 'hold');
});

test('unknown model-ref candidate still passes validation when a raw model key is allowed', () => {
	const drafts = {...draftsFrom(imageTool()), model: 'ollama/llava'};
	const submitted = submitToolForm(imageTool(), drafts, {});
	assert.equal(submitted.kind, 'save');
	if (submitted.kind === 'save') {
		assert.equal(submitted.input.values.model, 'ollama/llava');
	}
});
