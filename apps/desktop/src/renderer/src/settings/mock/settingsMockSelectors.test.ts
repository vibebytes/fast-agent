import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettingsMockState} from './settingsMockData';
import {selectDefaultModel, selectModelsByProvider, selectProject} from './settingsMockSelectors';

test('selects the effective default model and project', () => {
	assert.equal(selectDefaultModel(defaultSettingsMockState)?.name, 'GPT-5');
	assert.equal(selectProject(defaultSettingsMockState)?.name, 'fast-ide');
});

test('filters model catalog by provider', () => {
	assert.equal(selectModelsByProvider(defaultSettingsMockState, 'OpenAI').length, 1);
	assert.equal(selectModelsByProvider(defaultSettingsMockState, 'All').length, 3);
});
