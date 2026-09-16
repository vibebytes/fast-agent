import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ENGINE_SETTINGS_ACTIONS,
	engineSettingsRowClick,
	isEngineAvailable
} from './engineSettings.js';

test('settings row click never writes SetDefaultEngine', () => {
	assert.equal(engineSettingsRowClick(), 'ignore');
	assert.equal(ENGINE_SETTINGS_ACTIONS.includes('setDefault' as never), false);
});

test('isEngineAvailable is lifecycle readiness, not a default radio', () => {
	assert.equal(isEngineAvailable({kind: 'builtin', adapter: 'ready', program: 'builtin'}), true);
	assert.equal(isEngineAvailable({kind: 'extension', adapter: 'ready', program: 'installed'}), true);
	assert.equal(isEngineAvailable({kind: 'extension', adapter: 'ready', program: 'missing'}), false);
	assert.equal(isEngineAvailable({kind: 'extension', adapter: 'disabled', program: 'installed'}), false);
});
