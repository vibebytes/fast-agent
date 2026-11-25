import assert from 'node:assert/strict';
import {test} from 'node:test';
import {shouldEnableAppTray, shouldHideMainWindowOnClose} from './shellLifecycle.js';

test('macOS enables the app tray without the desktop pet', () => {
	assert.equal(shouldEnableAppTray('darwin', false), true);
	assert.equal(shouldEnableAppTray('darwin', true), true);
});

test('non-macOS tray visibility remains controlled by the desktop pet', () => {
	assert.equal(shouldEnableAppTray('win32', false), false);
	assert.equal(shouldEnableAppTray('win32', true), true);
	assert.equal(shouldEnableAppTray('linux', false), false);
	assert.equal(shouldEnableAppTray('linux', true), true);
});

test('macOS main-window close hides instead of quitting', () => {
	assert.equal(shouldHideMainWindowOnClose('darwin', false, false), true);
	assert.equal(shouldHideMainWindowOnClose('darwin', false, true), true);
});

test('application quit is never intercepted by window close', () => {
	assert.equal(shouldHideMainWindowOnClose('darwin', true, false), false);
	assert.equal(shouldHideMainWindowOnClose('win32', true, true), false);
});

test('non-macOS close interception remains limited to an active pet', () => {
	assert.equal(shouldHideMainWindowOnClose('win32', false, true), true);
	assert.equal(shouldHideMainWindowOnClose('win32', false, false), false);
	assert.equal(shouldHideMainWindowOnClose('linux', false, true), true);
	assert.equal(shouldHideMainWindowOnClose('linux', false, false), false);
});
