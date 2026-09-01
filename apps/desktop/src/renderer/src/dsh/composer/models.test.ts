import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	currentChoice,
	effortChoices,
	effortLabel,
	failSnap,
	modelChrome,
	okSnap,
	type DshModelsSnap
} from './models';

const reasoning = {
	efforts: [
		{id: 'off', name: 'Off'},
		{id: 'high', name: 'High'},
		{id: 'max', name: 'Max', description: 'Largest budget'}
	],
	defaultEffort: 'high'
};

const value = {
	current: {provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high'},
	routable: true,
	groups: [
		{
			id: 'deepseek-official',
			name: 'DeepSeek',
			models: [{id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning}]
		}
	],
	failures: []
};

const idle: DshModelsSnap = {
	current: null,
	routable: null,
	groups: [],
	failures: [],
	ready: false,
	loading: false,
	notice: null,
	error: null
};

test('modelChrome does not call the first paint a not-ready failure', () => {
	assert.deepEqual(modelChrome({...idle, loading: true}), {
		label: '正在加载',
		modelLabel: '正在加载',
		spinning: true,
		pane: 'loading'
	});
	assert.deepEqual(modelChrome(idle), {
		label: 'DSH models',
		modelLabel: 'DSH models',
		spinning: false,
		pane: 'retry'
	});
});

test('modelChrome shows the engine notice after a failed load and stops spinning', () => {
	const failed = failSnap({code: 'unavailable', message: '需要重启应用以加载 DSH 模型通道'});
	assert.equal(failed.loading, false);
	assert.equal(failed.ready, false);
	assert.deepEqual(modelChrome(failed), {
		label: '需要重启应用以加载 DSH 模型通道',
		modelLabel: '需要重启应用以加载 DSH 模型通道',
		spinning: false,
		pane: 'retry'
	});
});

test('modelChrome uses catalog display names, not wire ids', () => {
	const ready = okSnap(value);
	assert.deepEqual(modelChrome(ready), {
		label: 'DeepSeek-V4-Flash High',
		modelLabel: 'DeepSeek-V4-Flash',
		effortLabel: 'High',
		spinning: false,
		pane: 'list'
	});
	assert.deepEqual(modelChrome({...ready, loading: true}), {
		label: 'DeepSeek-V4-Flash High',
		modelLabel: 'DeepSeek-V4-Flash',
		effortLabel: 'High',
		spinning: true,
		pane: 'list'
	});
});

test('currentChoice is unset when the advertised model is gone', () => {
	const snap = okSnap({
		...value,
		current: {provider: 'deepseek-official', model: 'removed-model'}
	});
	assert.equal(currentChoice(snap), null);
	assert.deepEqual(modelChrome(snap), {
		label: '选择模型',
		modelLabel: '选择模型',
		spinning: false,
		pane: 'list'
	});
});

test('effortLabel uses adapter names and Default when there is no model default', () => {
	const withDefault = currentChoice(okSnap(value));
	assert.equal(effortLabel(withDefault, 'max'), 'Max');
	assert.equal(effortLabel(withDefault, undefined), 'High');

	const noDefault = currentChoice(
		okSnap({
			current: {provider: 'provider', model: 'model'},
			routable: true,
			groups: [
				{
					id: 'provider',
					name: 'Provider',
					models: [{id: 'model', name: 'Model', reasoning: {efforts: [{id: 'standard', name: 'Standard'}]}}]
				}
			],
			failures: []
		})
	);
	assert.equal(effortLabel(noDefault, undefined), 'Default');
	assert.equal(effortLabel(null, 'max'), undefined);
});

test('effortChoices prepends Default only when the adapter has no defaultEffort', () => {
	assert.deepEqual(
		effortChoices(currentChoice(okSnap(value))).map(c => c.label),
		['Off', 'High', 'Max']
	);
	const noDefault = currentChoice(
		okSnap({
			current: {provider: 'provider', model: 'model'},
			routable: true,
			groups: [
				{
					id: 'provider',
					name: 'Provider',
					models: [{id: 'model', name: 'Model', reasoning: {efforts: [{id: 'standard', name: 'Standard'}]}}]
				}
			],
			failures: []
		})
	);
	assert.deepEqual(
		effortChoices(noDefault).map(c => [c.label, c.effort]),
		[
			['Default', undefined],
			['Standard', 'standard']
		]
	);
	assert.deepEqual(effortChoices(null), []);
});
