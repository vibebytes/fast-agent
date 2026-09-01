import test from 'node:test';
import assert from 'node:assert/strict';
import {boundaryStateAfterError, boundaryStateAfterRetry} from './ErrorBoundary.js';

test('boundary error keeps epoch; retry clears error and bumps epoch (remount key)', () => {
	const initial = {error: null, epoch: 0};
	const failed = boundaryStateAfterError(initial, new Error('boom'));
	assert.equal(failed.error?.message, 'boom');
	assert.equal(failed.epoch, 0);

	const retried = boundaryStateAfterRetry(failed);
	assert.equal(retried.error, null);
	assert.equal(retried.epoch, 1, 'epoch bump must remount the failed subtree');

	const failedAgain = boundaryStateAfterError(retried, new Error('again'));
	const retriedAgain = boundaryStateAfterRetry(failedAgain);
	assert.equal(retriedAgain.epoch, 2);
});
