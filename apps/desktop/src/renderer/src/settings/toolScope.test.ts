import assert from 'node:assert/strict';
import test from 'node:test';
import type {ConfigurableTool} from '@fast-ide/session-view';
import {formFields, scopeOf, scopeSaveInput, toolScope} from './toolScope.js';

const imageTool: ConfigurableTool = {
	name: 'generate_image',
	titleKey: 'tools.generate_image.title',
	summaryKey: 'tools.generate_image.summary',
	status: 'active',
	fields: [
		{key: 'apiKey', type: 'secret', required: true},
		{key: 'model', type: 'model-ref', required: true},
		{key: 'size', type: 'choice', required: false, options: ['1024x1024', '1536x1024']},
		{key: 'sessionScope', type: 'choice', required: false, options: ['main_only', 'all_sessions']},
	],
	values: {apiKey: 'sk-1', model: 'openrouter/openai/gpt-image-2', size: '1024x1024', sessionScope: 'main_only'},
	secrets: {apiKey: {present: true}},
};

test('scopeOf falls back to main_only for unknown or absent values', () => {
	assert.equal(scopeOf(imageTool.values), 'main_only');
	assert.equal(scopeOf({...imageTool.values, sessionScope: 'all_sessions'}), 'all_sessions');
	assert.equal(scopeOf({}), 'main_only');
	assert.equal(scopeOf({sessionScope: 'junk'}), 'main_only');
});

test('scopeSaveInput stores the choice in the configured values', () => {
	const input = scopeSaveInput(imageTool, 'all_sessions');
	assert.equal(input.name, 'generate_image');
	assert.equal(input.enabled, true);
	assert.equal(input.values.sessionScope, 'all_sessions');
	const paused = scopeSaveInput({...imageTool, status: 'paused'}, 'all_sessions');
	assert.equal(paused.enabled, false);
});

test('formFields hides the session scope control from the regular form', () => {
	const keys = formFields(imageTool).map((field) => field.key);
	assert.ok(!keys.includes('sessionScope'));
	assert.equal(keys.length, imageTool.fields.length - 1);
});

test('toolScope prefers the effective scope reported by the engine', () => {
	assert.equal(toolScope({...imageTool, sessionScope: 'all_sessions'}), 'all_sessions');
	assert.equal(toolScope({...imageTool, sessionScope: 'junk'}), 'main_only');
	assert.equal(toolScope(imageTool), 'main_only');
	assert.equal(toolScope({...imageTool, values: {sessionScope: 'all_sessions'}}), 'all_sessions');
});
