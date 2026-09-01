import assert from 'node:assert/strict';
import test from 'node:test';
import {
	hostDirName,
	isReservedDefaultFolder,
	joinRemotePath,
	parentRemotePath,
	sameRemotePath,
	stripTrailingSep
} from './remotePaths.js';

test('sameRemotePath ignores a trailing slash', () => {
	assert.equal(sameRemotePath('/home/kai/foo/', '/home/kai/foo'), true);
	assert.equal(stripTrailingSep('/home/kai/foo/'), '/home/kai/foo');
	assert.equal(isReservedDefaultFolder('/home/kai/Documents/fast_workspace/.default_project/'), true);
	assert.equal(isReservedDefaultFolder('/home/kai/code'), false);
	assert.equal(parentRemotePath('/home/kai/foo/bar'), '/home/kai/foo');
	assert.equal(parentRemotePath('/home/kai/foo/'), '/home/kai');
	assert.equal(parentRemotePath('/'), '/');
	assert.equal(joinRemotePath('/home/kai/', 'code'), '/home/kai/code');
	assert.equal(joinRemotePath('/', 'tmp'), '/tmp');
	assert.equal(hostDirName(' code '), 'code');
	assert.equal(hostDirName('a/b'), undefined);
	assert.equal(hostDirName('.default_project'), undefined);
});
