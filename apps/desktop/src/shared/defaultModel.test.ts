import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	composerModelLabel,
	concreteModelDisplay,
	DefaultModelDisplay,
	isUnresolvedModelDisplay,
	isYamlDefaultStub,
	wireUseModel
} from './defaultModel.js';

test('yaml default stub is unresolved chrome, not a catalog paint', () => {
	assert.equal(isYamlDefaultStub(DefaultModelDisplay), true);
	assert.equal(isUnresolvedModelDisplay('default'), true);
	assert.equal(isUnresolvedModelDisplay(DefaultModelDisplay), true);
	assert.equal(isUnresolvedModelDisplay('deepseek/deepseek-v4-flash'), false);
});

test('concreteModelDisplay does not invent the yaml nemotron id', () => {
	assert.equal(concreteModelDisplay('default', 'default'), '');
	assert.equal(concreteModelDisplay('default', 'Default'), '');
	assert.equal(concreteModelDisplay('default', ''), '');
	assert.equal(concreteModelDisplay('default'), '');
	assert.equal(concreteModelDisplay('default', DefaultModelDisplay), '');
	assert.equal(concreteModelDisplay(DefaultModelDisplay, DefaultModelDisplay), '');
});

test('concreteModelDisplay keeps real labels', () => {
	assert.equal(concreteModelDisplay('gpt-4o', 'gpt-4o'), 'gpt-4o');
	assert.equal(
		concreteModelDisplay('default', 'openai/gpt-5.6-luna'),
		'openai/gpt-5.6-luna'
	);
});

test('composerModelLabel is a short visible chip, not the alias or yaml stub', () => {
	assert.equal(composerModelLabel('default', 'default'), '');
	assert.equal(composerModelLabel('gpt-4o', 'gpt-4o'), 'gpt-4o');
	assert.notEqual(composerModelLabel('default', 'Default').toLowerCase(), 'default');
	assert.equal(composerModelLabel('default', DefaultModelDisplay).includes('nemotron'), false);
});

test('wireUseModel never sends the alias stub or yaml default', () => {
	assert.equal(wireUseModel('default', 'openai/gpt-5.6-luna'), 'openai/gpt-5.6-luna');
	assert.equal(wireUseModel('default', 'Default'), undefined);
	assert.equal(wireUseModel('default', ''), undefined);
	assert.equal(wireUseModel('luna', 'openai/gpt-5.6-luna'), 'luna');
	assert.equal(wireUseModel('default', DefaultModelDisplay), undefined);
	assert.equal(wireUseModel(DefaultModelDisplay, DefaultModelDisplay), undefined);
});
