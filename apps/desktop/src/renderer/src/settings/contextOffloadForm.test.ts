import assert from 'node:assert/strict';
import {test} from 'node:test';
import {contextOffloadChecked, contextOffloadPatch} from './contextOffloadForm.js';

test('missing or non-boolean context payload stays off', () => {
	assert.equal(contextOffloadChecked(undefined), false);
	assert.equal(contextOffloadChecked(null), false);
	assert.equal(contextOffloadChecked('context'), false);
	assert.equal(contextOffloadChecked({}), false);
	assert.equal(contextOffloadChecked({contextOffload: false}), false);
	assert.equal(contextOffloadChecked({contextOffload: 'true'}), false);
	assert.equal(contextOffloadChecked({contextOffload: 1}), false);
});

test('JSON true turns context offload on', () => {
	assert.equal(contextOffloadChecked({contextOffload: true}), true);
});

test('the patch writes only contextOffload under the context namespace', () => {
	const on = contextOffloadPatch(true);
	const off = contextOffloadPatch(false);
	assert.equal(on.namespace, 'context');
	assert.deepEqual(on.patch, {contextOffload: true});
	assert.equal(off.namespace, 'context');
	assert.deepEqual(off.patch, {contextOffload: false});
	assert.equal('jevContext' in on.patch, false);
	assert.equal('jevContext' in off.patch, false);
});
