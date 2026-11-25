import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	ensureEnabledAppTray,
	handleMainWindowClose,
	syncAppTrayAfterPetChange
} from './shellLifecycle.js';

function closeHarness(platform: NodeJS.Platform) {
	const actions: string[] = [];
	let prevented = false;
	const close = (isQuitting = false, petCompanionActive = false) => {
		handleMainWindowClose(
			{preventDefault: () => { prevented = true; }},
			{
				platform,
				isQuitting,
				petCompanionActive,
				hide: () => { actions.push('hide'); },
				ensureDock: () => { actions.push('dock'); },
				installTray: () => { actions.push('tray'); }
			}
		);
	};
	return {actions, close, wasPrevented: () => prevented};
}

test('macOS close event prevents closing and hides the main window', () => {
	const h = closeHarness('darwin');
	h.close();
	assert.equal(h.wasPrevented(), true);
	assert.deepEqual(h.actions, ['hide', 'dock', 'tray']);
});

test('macOS quit event is not intercepted', () => {
	const h = closeHarness('darwin');
	h.close(true);
	assert.equal(h.wasPrevented(), false);
	assert.deepEqual(h.actions, []);
});

test('non-macOS close event still requires an active pet', () => {
	const withoutPet = closeHarness('linux');
	withoutPet.close();
	assert.equal(withoutPet.wasPrevented(), false);
	assert.deepEqual(withoutPet.actions, []);

	const withPet = closeHarness('linux');
	withPet.close(false, true);
	assert.equal(withPet.wasPrevented(), true);
	assert.deepEqual(withPet.actions, ['hide', 'dock', 'tray']);
});

test('startup action installs the tray on macOS without the pet', () => {
	let installs = 0;
	ensureEnabledAppTray('darwin', false, () => { installs += 1; });
	assert.equal(installs, 1);
});

test('startup action preserves non-macOS tray gating', () => {
	let installs = 0;
	ensureEnabledAppTray('win32', false, () => { installs += 1; });
	assert.equal(installs, 0);
	ensureEnabledAppTray('win32', true, () => { installs += 1; });
	assert.equal(installs, 1);
});

function petHarness(platform: NodeJS.Platform, hidden: boolean) {
	const actions: string[] = [];
	const sync = (petVisible: boolean) => syncAppTrayAfterPetChange(platform, petVisible, {
		hidden: () => hidden,
		installTray: () => { actions.push('tray'); },
		destroyTray: () => { actions.push('destroy'); },
		quit: () => { actions.push('quit'); }
	});
	return {actions, sync};
}

test('disabling the pet preserves a hidden macOS window and its tray', () => {
	const h = petHarness('darwin', true);
	h.sync(false);
	assert.deepEqual(h.actions, []);
});

test('disabling the pet on macOS never destroys the tray', () => {
	const h = petHarness('darwin', false);
	h.sync(false);
	assert.deepEqual(h.actions, []);
});

test('non-macOS pet visibility behavior remains unchanged', () => {
	const hidden = petHarness('win32', true);
	hidden.sync(false);
	assert.deepEqual(hidden.actions, ['quit']);

	const visible = petHarness('win32', false);
	visible.sync(false);
	assert.deepEqual(visible.actions, ['destroy']);

	const enabled = petHarness('win32', false);
	enabled.sync(true);
	assert.deepEqual(enabled.actions, ['tray']);
});
