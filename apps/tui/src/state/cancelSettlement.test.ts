import test from 'node:test';
import assert from 'node:assert/strict';
import {
	CANCEL_SETTLEMENT_TIMEOUT_MS,
	canAutoDequeue,
	composerGateFromRunFlags
} from '@fast-ide/session-view';

test('cli-ink uses shared session-view cancel settlement timeout (~12s)', () => {
	assert.equal(CANCEL_SETTLEMENT_TIMEOUT_MS, 12_000);
});

test('cli-ink uses composerGateFromRunFlags: Stopping allows enqueue', () => {
	const g = composerGateFromRunFlags({
		sessionReady: true,
		running: true,
		awaitingCancelSettlement: true,
		approvals: [],
		questions: []
	});
	assert.equal(g.runState, 'stopping');
	assert.equal(g.canEnqueue, true);
	assert.equal(g.canSubmitNow, false);
	assert.equal(g.composerLocked, false);
});

test('cli-ink uses shared canAutoDequeue: never on cancel path', () => {
	assert.equal(canAutoDequeue('finished'), true);
	assert.equal(canAutoDequeue('cancelled'), false);
});
