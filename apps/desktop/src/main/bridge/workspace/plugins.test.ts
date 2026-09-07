import assert from 'node:assert/strict';
import test from 'node:test';
import {engineWriteTimeout} from './plugins.js';
import {pickerEngineIds} from './enginePickerIds.js';
import type {EngineWireRow} from '@fast-ide/session-view';

function row(id: string, patch: Partial<EngineWireRow> = {}): EngineWireRow {
	return {
		id,
		kind: id === 'fast' ? 'builtin' : 'extension',
		adapter: 'ready',
		program: id === 'fast' ? 'builtin' : 'installed',
		process: id === 'fast' ? 'none' : 'stopped',
		isDefault: id === 'fast',
		inRegistry: id === 'fast',
		actions: [],
		...patch
	};
}

test('EnableEngine/StartEngine wait longer than DSH first-boot ready', () => {
	assert.equal(engineWriteTimeout('EnableEngine'), 60_000);
	assert.equal(engineWriteTimeout('StartEngine'), 60_000);
	assert.ok(engineWriteTimeout('EnableEngine') > 20_000);
	assert.equal(engineWriteTimeout('DisableEngine'), 12_000);
	assert.equal(engineWriteTimeout('InstallEngine'), 15 * 60_000);
});

test('pickerEngineIds includes ready installed dsh before inRegistry', () => {
	assert.deepEqual(
		pickerEngineIds([
			row('fast', {inRegistry: true}),
			row('dsh', {inRegistry: false, adapter: 'ready', program: 'installed'})
		]),
		['fast', 'dsh']
	);
});

test('pickerEngineIds hides disabled or missing dsh', () => {
	assert.deepEqual(
		pickerEngineIds([
			row('fast', {inRegistry: true}),
			row('dsh', {inRegistry: false, adapter: 'disabled', program: 'missing', actions: ['enable']})
		]),
		['fast']
	);
});
