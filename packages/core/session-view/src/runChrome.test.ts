import test from 'node:test';
import assert from 'node:assert/strict';
import {
	chromeAwaitingSettlement,
	chromeFromServer,
	chromePostRun,
	chromeRunId,
	chromeStopLit,
	IDLE_RUN_CHROME,
	runChromeTransition,
	SETTLED_RUN_CHROME,
	type RunChrome
} from './runChrome.js';

const active = (runId: string, fromServer = false): RunChrome => ({phase: 'active', runId, fromServer});
const cancelPending = (runId?: string): RunChrome =>
	runId ? {phase: 'cancelPending', runId, fromServer: false} : {phase: 'cancelPending', fromServer: false};
const sealedRun = (runId: string): RunChrome => ({phase: 'sealedRun', runId, fromServer: false});

test('predicates reproduce the legacy flag semantics', () => {
	assert.equal(chromeRunId(IDLE_RUN_CHROME), undefined);
	assert.equal(chromeRunId(active('r1')), 'r1');
	assert.equal(chromeRunId(cancelPending('r1')), 'r1');
	assert.equal(chromeRunId(cancelPending()), undefined);
	assert.equal(chromeRunId(sealedRun('r1')), 'r1');
	assert.equal(chromeRunId(SETTLED_RUN_CHROME), undefined);

	assert.equal(chromePostRun(SETTLED_RUN_CHROME), true);
	assert.equal(chromePostRun(sealedRun('r1')), true);
	assert.equal(chromePostRun(active('r1')), false);
	assert.equal(chromePostRun(IDLE_RUN_CHROME), false);

	assert.equal(chromeAwaitingSettlement(cancelPending('r1')), true);
	assert.equal(chromeAwaitingSettlement(active('r1')), false);
	assert.equal(chromeAwaitingSettlement(SETTLED_RUN_CHROME), false);

	assert.equal(chromeStopLit(active('r1')), true);
	assert.equal(chromeStopLit(cancelPending('r1')), true);
	assert.equal(chromeStopLit(sealedRun('r1')), false);
	assert.equal(chromeStopLit(SETTLED_RUN_CHROME), false);

	assert.equal(chromeFromServer(active('r1', true)), true);
	assert.equal(chromeFromServer(SETTLED_RUN_CHROME), false);
	assert.equal(chromeFromServer(IDLE_RUN_CHROME), false);
});

test('local cancel keeps the run id and implies postRun', () => {
	assert.deepEqual(
		runChromeTransition(active('r1', true), {postRun: true, awaiting: true}),
		{phase: 'cancelPending', runId: 'r1', fromServer: true}
	);
	assert.deepEqual(runChromeTransition(IDLE_RUN_CHROME, {postRun: true, awaiting: true}), {
		phase: 'cancelPending',
		fromServer: false
	});
});

test('goal notice clears awaiting without dropping the run id', () => {
	assert.deepEqual(runChromeTransition(cancelPending('r1'), {awaiting: false}), sealedRun('r1'));
	assert.deepEqual(runChromeTransition(active('r1'), {awaiting: false}), active('r1'));
	assert.deepEqual(runChromeTransition(SETTLED_RUN_CHROME, {awaiting: false}), SETTLED_RUN_CHROME);
	assert.deepEqual(runChromeTransition(IDLE_RUN_CHROME, {awaiting: false}), IDLE_RUN_CHROME);
});

test('turn_finished variants: keepActive, extinguish mid-stream, settle', () => {
	assert.deepEqual(runChromeTransition(active('r1'), {postRun: false, awaiting: false}), active('r1'));
	assert.deepEqual(runChromeTransition(active('r1'), {run: 'clear', postRun: false, awaiting: false}), IDLE_RUN_CHROME);
	assert.deepEqual(runChromeTransition(active('r1'), {run: 'clear', postRun: true, awaiting: false}), SETTLED_RUN_CHROME);
});

test('run_done keeps a foreign run id when sealing', () => {
	assert.deepEqual(runChromeTransition(active('r2'), {postRun: true, awaiting: false}), sealedRun('r2'));
});

test('failed run clears only its own id, cancelPending survives other-run failures', () => {
	assert.deepEqual(
		runChromeTransition(active('r2'), {run: 'keep', postRun: true, awaiting: false}),
		sealedRun('r2')
	);
	assert.deepEqual(
		runChromeTransition(cancelPending('r2'), {run: 'keep', postRun: true, awaiting: 'keep'}),
		cancelPending('r2')
	);
	assert.deepEqual(
		runChromeTransition(cancelPending('r1'), {run: 'clear', postRun: true, awaiting: 'keep'}),
		{phase: 'cancelPending', fromServer: false}
	);
});

test('input_accepted repins the run id with fromServer, keeping the phase', () => {
	assert.deepEqual(
		runChromeTransition(sealedRun('old'), {run: {id: 'new', fromServer: true}}),
		{phase: 'sealedRun', runId: 'new', fromServer: true}
	);
	assert.deepEqual(
		runChromeTransition(active('old'), {run: {id: 'new', fromServer: true}}),
		{phase: 'active', runId: 'new', fromServer: true}
	);
});

test('turn_started arms a fresh run without server trust', () => {
	assert.deepEqual(
		runChromeTransition(SETTLED_RUN_CHROME, {run: {id: 't1', fromServer: false}, postRun: false, awaiting: false}),
		{phase: 'active', runId: 't1', fromServer: false}
	);
	assert.deepEqual(
		runChromeTransition(SETTLED_RUN_CHROME, {postRun: false, awaiting: false}),
		IDLE_RUN_CHROME
	);
});

test('lease expiry and cold restore settle outright', () => {
	assert.deepEqual(runChromeTransition(active('r1'), {run: 'clear', postRun: true, awaiting: false}), SETTLED_RUN_CHROME);
	assert.deepEqual(runChromeTransition(sealedRun('r1'), {run: 'clear', postRun: true, awaiting: false}), SETTLED_RUN_CHROME);
});

test('revive arms the run from engine state', () => {
	assert.deepEqual(
		runChromeTransition(SETTLED_RUN_CHROME, {run: {id: 'r1', fromServer: true}, postRun: false, awaiting: false}),
		{phase: 'active', runId: 'r1', fromServer: true}
	);
});
