import assert from 'node:assert/strict';
import test from 'node:test';
import {diffModelPaths} from './diffModelPaths';

test('original and modified use distinct non-empty model URIs per diff instance', () => {
	const paths = diffModelPaths(':r1:');
	assert.ok(paths.originalModelPath);
	assert.ok(paths.modifiedModelPath);
	assert.notEqual(paths.originalModelPath, paths.modifiedModelPath);
	assert.notEqual(diffModelPaths(':r1:').originalModelPath, diffModelPaths(':r2:').originalModelPath);
	assert.notEqual(diffModelPaths(':r1:').modifiedModelPath, diffModelPaths(':r2:').modifiedModelPath);
});
