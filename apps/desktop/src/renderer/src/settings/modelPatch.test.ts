import assert from 'node:assert/strict';
import test from 'node:test';
import {applyModelPatch} from './modelPatch.js';

type Row = {modelId: string; [k: string]: unknown};
type P = {id: string; models?: Row[]; enabledModelCount?: number; modelCount?: number};

const mkProvider = (models?: Row[]): P => ({
	id: 'p1',
	models,
	enabledModelCount: (models ?? []).filter((m) => m.enabled === true).length,
	modelCount: (models ?? []).length
});

test('enable keeps modalities and capabilities untouched', () => {
	const list: P[] = [
		mkProvider([
			{modelId: 'm1', enabled: false, source: 'engine', inputModalities: ['text'], capabilities: ['image_generation']}
		])
	];
	const out = applyModelPatch(list, 'p1', [{op: 'enable', modelId: 'm1', enabled: true}]);
	assert.ok(out);
	assert.equal(out[0].models![0].enabled, true);
	assert.deepEqual(out[0].models![0].inputModalities, ['text']);
	assert.deepEqual(out[0].models![0].capabilities, ['image_generation']);
	assert.equal(out[0].enabledModelCount, 1);
});

test('enable can patch modalities and capabilities including clearing', () => {
	const list: P[] = [
		mkProvider([
			{modelId: 'm1', enabled: false, source: 'engine', inputModalities: ['text'], capabilities: ['ocr']}
		])
	];
	const out = applyModelPatch(list, 'p1', [
		{op: 'enable', modelId: 'm1', enabled: true, inputModalities: ['text', 'image'], capabilities: []}
	]);
	assert.ok(out);
	assert.equal(out[0].models![0].enabled, true);
	assert.deepEqual(out[0].models![0].inputModalities, ['text', 'image']);
	assert.deepEqual(out[0].models![0].capabilities, []);
});

test('add creates a manual model with media fields and updates counts', () => {
	const out = applyModelPatch([mkProvider([])], 'p1', [
		{
			op: 'add',
			modelId: 'm9',
			displayName: 'M9',
			inputModalities: ['text', 'image'],
			capabilities: ['image_generation']
		}
	]);
	assert.ok(out);
	const m = out[0].models![0];
	assert.equal(m.modelId, 'm9');
	assert.equal(m.displayName, 'M9');
	assert.equal(m.enabled, true);
	assert.equal(m.source, 'manual');
	assert.deepEqual(m.inputModalities, ['text', 'image']);
	assert.deepEqual(m.capabilities, ['image_generation']);
	assert.equal(out[0].modelCount, 1);
	assert.equal(out[0].enabledModelCount, 1);
});

test('add without media fields leaves them undefined', () => {
	const out = applyModelPatch([mkProvider([])], 'p1', [{op: 'add', modelId: 'm9'}]);
	assert.ok(out);
	assert.equal(out[0].models![0].inputModalities, undefined);
	assert.equal(out[0].models![0].capabilities, undefined);
});

test('duplicate add is a no-op returning null', () => {
	const list: P[] = [mkProvider([{modelId: 'm1', enabled: true, source: 'manual'}])];
	const out = applyModelPatch(list, 'p1', [{op: 'add', modelId: 'm1'}]);
	assert.equal(out, null);
});

test('unknown provider id returns null', () => {
	assert.equal(applyModelPatch([mkProvider([])], 'nope', [{op: 'enable', modelId: 'm1', enabled: true}]), null);
});

test('no effective change returns null', () => {
	const list: P[] = [mkProvider([{modelId: 'm1', enabled: true, source: 'engine'}])];
	assert.equal(applyModelPatch(list, 'p1', [{op: 'enable', modelId: 'missing', enabled: true}]), null);
});

test('remove and rename keep old behaviour and recount', () => {
	const list: P[] = [
		mkProvider([
			{modelId: 'm1', enabled: true, source: 'engine', displayName: 'Old'},
			{modelId: 'm2', enabled: false, source: 'manual'}
		])
	];
	const removed = applyModelPatch(list, 'p1', [{op: 'remove', modelId: 'm1'}]);
	assert.ok(removed);
	assert.deepEqual(
		removed[0].models!.map((m) => m.modelId),
		['m2']
	);
	assert.equal(removed[0].modelCount, 1);
	assert.equal(removed[0].enabledModelCount, 0);

	const renamed = applyModelPatch(list, 'p1', [{op: 'rename', modelId: 'm1', displayName: 'New'}]);
	assert.ok(renamed);
	assert.equal(renamed[0].models![0].displayName, 'New');
});
