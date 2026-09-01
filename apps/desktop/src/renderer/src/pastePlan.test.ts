import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planPaste} from './pastePlan';

function dt(opts: {files?: unknown[]; plain?: string}): Pick<DataTransfer, 'files' | 'getData'> {
	return {
		files: opts.files ?? [],
		getData: (type: string) => (type === 'text/plain' ? (opts.plain ?? '') : '')
	} as unknown as Pick<DataTransfer, 'files' | 'getData'>;
}

test('planPaste prefers files over any text flavor', () => {
	assert.deepEqual(planPaste(dt({files: [{name: 'a.txt'}], plain: '/tmp/a.txt'})), {
		mode: 'files',
		files: [{name: 'a.txt'}]
	});
});

test('planPaste reads only the text/plain flavor', () => {
	assert.deepEqual(planPaste(dt({plain: 'hello'})), {mode: 'text', text: 'hello'});
});

test('planPaste ignores html-only clipboards', () => {
	assert.equal(planPaste(dt({})).mode, 'ignore');
});

test('planPaste ignores empty clipboard', () => {
	assert.equal(planPaste(null).mode, 'ignore');
});
