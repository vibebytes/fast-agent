import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPackagedRuntime} from './packagedRuntime.js';

test('applyPackagedRuntime is a no-op when unpackaged', () => {
	const env: NodeJS.ProcessEnv = {};
	applyPackagedRuntime({
		isPackaged: false,
		resourcesPath: '/app/Contents/Resources',
		env,
		existsSync: () => true
	});
	assert.equal(env.FAST_BUNDLED_ENGINE, undefined);
});

test('applyPackagedRuntime sets bundled engine and prepends bin', () => {
	const env: NodeJS.ProcessEnv = {PATH: '/usr/bin'};
	const resources = '/app/Contents/Resources';
	applyPackagedRuntime({
		isPackaged: true,
		resourcesPath: resources,
		env,
		platform: 'darwin',
		existsSync: () => true
	});
	assert.equal(env.ELECTRON_RESOURCES_PATH, resources);
	assert.equal(env.FAST_BUNDLED_ENGINE, `${resources}/engine/bin/fast-cli`);
	assert.ok(env.PATH?.startsWith(`${resources}/bin`));
});
