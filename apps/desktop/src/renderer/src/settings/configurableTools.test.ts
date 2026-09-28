import assert from 'node:assert/strict';
import test from 'node:test';
import type {ConfigurableTool} from '@fast-ide/session-view';
import {visiblePluginTabs} from './pluginTabs.js';
import {draftsFrom, submitToolForm, toolsSurface} from './toolForm.js';

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
