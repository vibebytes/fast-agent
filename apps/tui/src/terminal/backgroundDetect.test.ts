import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOsc11Response, classifyBackground} from './backgroundDetect.js';

test('parseOsc11Response handles 4-digit-per-channel replies (BEL and ST)', () => {
	assert.deepEqual(
		parseOsc11Response('\u001b]11;rgb:1e1e/2222/2727\u0007'),
		{r: 30, g: 34, b: 39}
	);
	assert.deepEqual(
		parseOsc11Response('\u001b]11;rgb:ffff/ffff/ffff\u001b\\'),
		{r: 255, g: 255, b: 255}
	);
});

test('parseOsc11Response handles 2-digit channels and rejects garbage', () => {
	assert.deepEqual(parseOsc11Response('\u001b]11;rgb:28/2a/36\u0007'), {r: 40, g: 42, b: 54});
	assert.equal(parseOsc11Response('hello world'), undefined);
	assert.equal(parseOsc11Response('\u001b]10;rgb:ff/ff/ff\u0007'), undefined);
});

test('classifyBackground splits dark and light at perceptual luma', () => {
	assert.equal(classifyBackground({r: 30, g: 34, b: 39}), 'dark');     // one-dark bg
	assert.equal(classifyBackground({r: 40, g: 42, b: 54}), 'dark');     // dracula bg
	assert.equal(classifyBackground({r: 255, g: 255, b: 255}), 'light'); // pure white
	assert.equal(classifyBackground({r: 253, g: 246, b: 227}), 'light'); // solarized light bg
});
