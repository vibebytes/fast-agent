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
	assert.equal(env.JAVA_HOME, `${resources}/engine/jre`);
	assert.ok(env.PATH?.startsWith(`${resources}/bin`));
	assert.ok(env.PATH?.includes(`${resources}/engine/jre/bin`));
});

test('applyPackagedRuntime overwrites JAVA_HOME', () => {
	const env: NodeJS.ProcessEnv = {PATH: '/usr/bin', JAVA_HOME: '/opt/jdk'};
	const resources = '/app/Contents/Resources';
	applyPackagedRuntime({
		isPackaged: true,
		resourcesPath: resources,
		env,
		platform: 'darwin',
		existsSync: () => true
	});
	assert.equal(env.JAVA_HOME, `${resources}/engine/jre`);
});

test('applyPackagedRuntime skips JAVA_HOME when jre is absent', () => {
	const env: NodeJS.ProcessEnv = {PATH: '/usr/bin'};
	applyPackagedRuntime({
		isPackaged: true,
		resourcesPath: '/app/Contents/Resources',
		env,
		platform: 'darwin',
		existsSync: p => !p.endsWith('/jre') && !p.includes('/jre/')
	});
	assert.equal(env.JAVA_HOME, undefined);
});
