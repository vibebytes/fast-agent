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
		existsSync: () => true,
		readFileSync: () => '0.3.1 temurin-17-darwin-arm64 2026-09-02T00:00:00.000Z\n'
	});
	assert.equal(env.ELECTRON_RESOURCES_PATH, resources);
	assert.equal(env.FAST_BUNDLED_ENGINE, `${resources}/engine/bin/fast-cli`);
	assert.equal(env.JAVA_HOME, `${resources}/engine/jre`);
	assert.equal(env.FAST_WANT_ENGINE_ID, '0.3.1 temurin-17-darwin-arm64 2026-09-02T00:00:00.000Z');
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
		existsSync: () => true,
		readFileSync: () => ''
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
		existsSync: p => !p.endsWith('/jre') && !p.includes('/jre/'),
		readFileSync: () => ''
	});
	assert.equal(env.JAVA_HOME, undefined);
});
