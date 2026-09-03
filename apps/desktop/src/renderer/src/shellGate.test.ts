import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {engineOverlay, engineOverlayVisible, reduceShellGate} from './shellGate.js';

const appSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'App.tsx'), 'utf8');

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

test('engine overlay never locks chrome; Retry only on error/exited', () => {
	assert.equal(engineOverlay('ready').visible, false);
	assert.equal(engineOverlay('ready').lockChrome, false);
	assert.equal(engineOverlay('reconnecting').visible, true);
	assert.equal(engineOverlay('reconnecting').lockChrome, false);
	assert.equal(engineOverlay('reconnecting').showRetry, false);
	assert.equal(engineOverlay('error').lockChrome, false);
	assert.equal(engineOverlay('error').showRetry, true);
	assert.equal(engineOverlay('exited').lockChrome, false);
	assert.equal(engineOverlay('exited').showRetry, true);
});

test('App mounts engine overlay inside SidebarInset without aria-modal', () => {
	const inset = appSrc.indexOf('<SidebarInset');
	const overlay = appSrc.indexOf('data-slot="engine-overlay"');
	const closeInset = appSrc.indexOf('</SidebarInset>');
	assert.ok(inset >= 0, 'SidebarInset present');
	assert.ok(overlay > inset, 'overlay opens after SidebarInset');
	assert.ok(overlay < closeInset, 'overlay closes before SidebarInset');
	assert.equal(appSrc.includes('aria-modal'), false);
});
