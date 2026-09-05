import assert from 'node:assert/strict';
import {test} from 'node:test';

import {NativeSocketEpoch} from './socket-epoch.ts';

test('stale close must not disconnect the socket that replaced it', () => {
	const epoch = new NativeSocketEpoch();
	const first = epoch.take();
	const second = epoch.take();
	assert.equal(first.mine(), false);
	assert.equal(second.mine(), true);
	let closed = 0;
	first.release(() => {
		closed += 1;
	});
	second.release(() => {
		closed += 1;
	});
	assert.equal(closed, 1);
});
