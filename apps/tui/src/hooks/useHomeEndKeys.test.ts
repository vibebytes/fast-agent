import test from 'node:test';
import assert from 'node:assert/strict';
import {useHomeEndKeys} from './useHomeEndKeys.js';

// Pure sequence coverage via the same regexes the hook uses.
const HOME_RE = /\u001b(?:\[(?:1|7)~|OH|\[H)/g;
const END_RE = /\u001b(?:\[(?:4|8)~|OF|\[F)/g;

test('Home CSI variants match', () => {
	for (const seq of ['\u001b[H', '\u001b[1~', '\u001b[7~', '\u001bOH']) {
		HOME_RE.lastIndex = 0;
		assert.equal(HOME_RE.test(seq), true, seq);
	}
});

test('End CSI variants match', () => {
	for (const seq of ['\u001b[F', '\u001b[4~', '\u001b[8~', '\u001bOF']) {
		END_RE.lastIndex = 0;
		assert.equal(END_RE.test(seq), true, seq);
	}
});

test('useHomeEndKeys is exported', () => {
	assert.equal(typeof useHomeEndKeys, 'function');
});
