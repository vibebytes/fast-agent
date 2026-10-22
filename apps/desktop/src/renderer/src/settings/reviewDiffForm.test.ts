import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	reviewDiffChecked,
	reviewDiffDocPayload,
	reviewDiffNamespace,
	reviewDiffPatch,
	reviewDiffSwitchOn
} from './reviewDiffForm.js';

test('missing or non-boolean checkpoint payload stays off', () => {
	assert.equal(reviewDiffChecked(undefined), false);
	assert.equal(reviewDiffChecked(null), false);
	assert.equal(reviewDiffChecked('checkpoint'), false);
	assert.equal(reviewDiffChecked({}), false);
	assert.equal(reviewDiffChecked({reviewDiff: false}), false);
	assert.equal(reviewDiffChecked({reviewDiff: 'true'}), false);
	assert.equal(reviewDiffChecked({reviewDiff: 1}), false);
});

test('JSON true turns review diff on', () => {
	assert.equal(reviewDiffChecked({reviewDiff: true}), true);
});

test('the patch writes only reviewDiff under the checkpoint namespace', () => {
	const on = reviewDiffPatch(true);
	const off = reviewDiffPatch(false);
	assert.equal(on.namespace, 'checkpoint');
	assert.deepEqual(on.patch, {reviewDiff: true});
	assert.equal(off.namespace, 'checkpoint');
	assert.deepEqual(off.patch, {reviewDiff: false});
	assert.equal('contextOffload' in on.patch, false);
	assert.equal('contextOffload' in off.patch, false);
});

test('the payload reader finds the checkpoint document among the settings docs', () => {
	assert.equal(reviewDiffNamespace, 'checkpoint');
	assert.deepEqual(
		reviewDiffDocPayload([
			{namespace: 'context', payload: {contextOffload: true}},
			{namespace: 'checkpoint', payload: {reviewDiff: true}}
		]),
		{reviewDiff: true}
	);
	assert.equal(reviewDiffDocPayload([{namespace: 'context', payload: {}}]), undefined);
	assert.equal(reviewDiffDocPayload([]), undefined);
});

test('an unknown switch state behaves open until settings are ready', () => {
	// Loading: the store's docs are empty, which would read as off and mute a working feature.
	assert.equal(reviewDiffSwitchOn('loading', undefined), true);
	assert.equal(reviewDiffSwitchOn('error', undefined), true);
	// Ready: the document decides, missing stays off.
	assert.equal(reviewDiffSwitchOn('ready', {reviewDiff: true}), true);
	assert.equal(reviewDiffSwitchOn('ready', {reviewDiff: false}), false);
	assert.equal(reviewDiffSwitchOn('ready', undefined), false);
});
