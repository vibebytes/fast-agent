import test from 'node:test';
import assert from 'node:assert/strict';
import {applyRuntimeEnv} from './runtimeEnv.js';

test('applyRuntimeEnv injects FAST_RUNTIME_ROOT under userData and prebuilds conf', () => {
	const env: NodeJS.ProcessEnv = {};
	const made: string[] = [];
	applyRuntimeEnv({
		env,
		userDataPath: '/data/app',
		mkdir: path => {
			made.push(path);
		}
	});
	assert.equal(env.FAST_RUNTIME_ROOT, `/data/app/runtime`);
	assert.deepEqual(made, [`/data/app/runtime/conf`]);
	assert.equal(env.FAST_ENGINES_YAML, undefined);
});

test('applyRuntimeEnv keeps an existing FAST_RUNTIME_ROOT', () => {
	const env: NodeJS.ProcessEnv = {FAST_RUNTIME_ROOT: '/custom/root'};
	applyRuntimeEnv({env, userDataPath: '/data/app'});
	assert.equal(env.FAST_RUNTIME_ROOT, '/custom/root');
});

test('applyRuntimeEnv sets bundled engines yaml only when packaged', () => {
	const packaged: NodeJS.ProcessEnv = {};
	applyRuntimeEnv({
		env: packaged,
		userDataPath: '/data/app',
		resourcesPath: '/app/Contents/Resources',
		isPackaged: true
	});
	assert.equal(packaged.FAST_ENGINES_YAML, `/app/Contents/Resources/engine/conf/engines.yaml`);

	const dev: NodeJS.ProcessEnv = {};
	applyRuntimeEnv({
		env: dev,
		userDataPath: '/data/app',
		resourcesPath: '/app/Contents/Resources',
		isPackaged: false
	});
	assert.equal(dev.FAST_ENGINES_YAML, undefined);
});
