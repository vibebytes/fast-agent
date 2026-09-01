import assert from 'node:assert/strict';
import {test} from 'node:test';
import {engineOverlayVisible, reduceShellGate} from './shellGate.js';

test('shell gate stays on landing until restored', () => {
	assert.equal(reduceShellGate('landing', {type: 'workspace:restored'}), 'shell');
});

test('shell gate opens on restoreFailed (timeout path)', () => {
	assert.equal(
		reduceShellGate('landing', {
			type: 'workspace:restoreFailed',
			reason: 'Engine startup timed out'
		}),
		'shell'
	);
});

test('shell gate does not leave shell once open', () => {
	assert.equal(
		reduceShellGate('shell', {
			type: 'workspace:restoreFailed',
			reason: 'x'
		}),
		'shell'
	);
	assert.equal(reduceShellGate('shell', {type: 'workspace:restored'}), 'shell');
});

test('engine overlay covers reconnecting/error/exited only', () => {
	assert.equal(engineOverlayVisible('ready'), false);
	assert.equal(engineOverlayVisible('starting'), false);
	assert.equal(engineOverlayVisible(null), false);
	assert.equal(engineOverlayVisible('reconnecting'), true);
	assert.equal(engineOverlayVisible('error'), true);
	assert.equal(engineOverlayVisible('exited'), true);
});
