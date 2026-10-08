import assert from 'node:assert/strict';
import {test} from 'node:test';
import {statusLabelKey} from './providerPresets.ts';
import {editTestUpsert, providerStatusNote} from './providerProbe.ts';

const current = {name: 'DeepSeek', vendor: 'deepseek', baseUrl: 'https://api.deepseek.com/v1'};

test('providerStatusNote keeps HTTP 401 so the edit dialog can show it', () => {
	assert.equal(providerStatusNote('HTTP 401'), 'HTTP 401');
	assert.equal(providerStatusNote('HTTP 401 Authentication Fails'), 'HTTP 401 Authentication Fails');
	assert.equal(providerStatusNote('  '), null);
});

test('auth_failed maps to the 凭据失效 label key', () => {
	assert.equal(statusLabelKey('auth_failed'), 'authFailed');
});

test('edit test with a typed key upserts that credential before probe', () => {
	const upsert = editTestUpsert('deepseek', current, {
		name: 'DeepSeek',
		baseUrl: current.baseUrl!,
		credential: 'sk-new-key'
	});
	assert.deepEqual(upsert, {
		id: 'deepseek',
		name: 'DeepSeek',
		presetKey: 'deepseek',
		baseUrl: 'https://api.deepseek.com/v1',
		credential: 'sk-new-key'
	});
});

test('edit test with empty key and unchanged fields probes the stored secret only', () => {
	assert.equal(
		editTestUpsert('deepseek', current, {
			name: 'DeepSeek',
			baseUrl: current.baseUrl!,
			credential: ''
		}),
		null
	);
});
