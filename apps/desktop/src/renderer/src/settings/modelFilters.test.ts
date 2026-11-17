import assert from 'node:assert/strict';
import test from 'node:test';
import {filterModelProviders} from './modelFilters.js';

type Row = {modelId: string; displayName: string; enabled: boolean};
type RowProvider = {id: string; models?: Row[]};

const empty = {id: 'empty', models: []};
const enabled = {id: 'enabled', models: [{modelId: 'm1', displayName: 'Visible', enabled: true}]};
const hidden = {id: 'hidden', models: [{modelId: 'm2', displayName: 'Hidden', enabled: false}]};
const providers: RowProvider[] = [empty, enabled, hidden];

test('zero-model providers stay visible in every visibility tab without a query', () => {
	for (const filter of ['enabled', 'hidden', 'all'] as const) {
		const rows = filterModelProviders(providers, filter, 'all', '');
		assert.equal(rows.some(p => p.id === 'empty'), true, filter);
		assert.deepEqual(rows.find(p => p.id === 'empty')?.models, []);
	}
});

test('nonempty providers still follow the selected visibility tab', () => {
	assert.deepEqual(filterModelProviders(providers, 'enabled', 'all', '').map(p => p.id), ['empty', 'enabled']);
	assert.deepEqual(filterModelProviders(providers, 'hidden', 'all', '').map(p => p.id), ['empty', 'hidden']);
	assert.deepEqual(filterModelProviders(providers, 'all', 'all', '').map(p => p.id), ['empty', 'enabled', 'hidden']);
});

test('search hides unrelated empty providers and filters models', () => {
	const rows = filterModelProviders(providers, 'all', 'all', 'visible');
	assert.deepEqual(rows.map(p => p.id), ['enabled']);
	assert.deepEqual(rows[0]?.models?.map(m => m.modelId), ['m1']);
	assert.deepEqual(filterModelProviders(providers, 'all', 'all', 'missing'), []);
});

test('an explicitly selected provider stays visible while filtering', () => {
	assert.deepEqual(filterModelProviders(providers, 'hidden', 'enabled', '').map(p => p.id), ['enabled']);
	assert.deepEqual(filterModelProviders(providers, 'all', 'empty', 'missing').map(p => p.id), ['empty']);
});
