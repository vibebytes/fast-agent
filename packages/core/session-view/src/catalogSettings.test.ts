import test from 'node:test';
import assert from 'node:assert/strict';
import {
	catalogEntryFor,
	createCatalogSettings,
	type CatalogSettingsTaskLike
} from './catalogSettings.js';
import type {ModelCatalogEntry} from './wire.js';

function entry(id: string, display: string): ModelCatalogEntry {
	return {
		id,
		display,
		aliases: [display],
		current: false,
		supportsThinking: false,
		supportedEfforts: []
	};
}

const zhipu = (): ModelCatalogEntry => entry('zhipu/glm-3.5-flash', 'glm-3.5-flash');
const other = (): ModelCatalogEntry => entry('other/glm-3.5-flash', 'glm-3.5-flash');

function makeSettings() {
	const tasks = new Map<string, CatalogSettingsTaskLike>();
	return createCatalogSettings({getActiveTask: () => null, tasks});
}

test('selectModel resolves the exact provider row when a same-name row sorts first', () => {
	const settings = makeSettings();
	settings.applyProviderCatalog([other(), zhipu()]);
	const out = settings.selectModel('zhipu/glm-3.5-flash');
	assert.equal(out?.resolvedId, 'zhipu/glm-3.5-flash');
});

test('selectModel marks exactly one current row for same-name cross-provider entries', () => {
	const settings = makeSettings();
	settings.applyProviderCatalog([other(), zhipu()]);
	settings.selectModel('zhipu/glm-3.5-flash');
	assert.deepEqual(
		settings.modelCatalog.filter(e => e.current).map(e => e.id),
		['zhipu/glm-3.5-flash']
	);
});

test('applyProviderCatalog keeps current unique for same-name cross-provider entries', () => {
	const settings = makeSettings();
	settings.applyProviderCatalog([other(), {...zhipu(), current: true}]);
	assert.deepEqual(
		settings.modelCatalog.filter(e => e.current).map(e => e.id),
		['zhipu/glm-3.5-flash']
	);
});

test('catalogEntryFor prefers the exact id over same-name display/alias matches', () => {
	const entries = [other(), zhipu()];
	assert.equal(catalogEntryFor(entries, 'zhipu/glm-3.5-flash')?.id, 'zhipu/glm-3.5-flash');
});

test('catalogEntryFor disambiguates a bare model name to the first matching row', () => {
	const entries = [other(), zhipu()];
	assert.equal(catalogEntryFor(entries, 'glm-3.5-flash')?.id, 'other/glm-3.5-flash');
});

test('catalogEntryFor still resolves display names and aliases', () => {
	const entries = [entry('openrouter/openai/gpt-5.6-terra', 'GPT-5.6 Terra'), zhipu()];
	assert.equal(
		catalogEntryFor(entries, 'GPT-5.6 Terra')?.id,
		'openrouter/openai/gpt-5.6-terra'
	);
	assert.equal(catalogEntryFor(entries, 'gpt-5.6 terra')?.id, 'openrouter/openai/gpt-5.6-terra');
	assert.equal(catalogEntryFor(entries, undefined), undefined);
});
