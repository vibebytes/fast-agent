import test from 'node:test';
import assert from 'node:assert/strict';
import {initialCopyMode, osc52Copy, reduceCopyMode, type Point} from './copyMode.js';

const point = (offset: number): Point => ({node: {nodeName: '#text'} as Point['node'], offset});

test('enter activates copy mode with collapsed selection', () => {
	const p = point(0);
	const state = reduceCopyMode(initialCopyMode(), {type: 'enter', point: p, cursor: {x: 1, y: 2}});
	assert.equal(state.active, true);
	assert.equal(state.anchor, p);
	assert.equal(state.focus, p);
	assert.deepEqual(state.cursor, {x: 1, y: 2});
});

test('move without extend replaces both ends', () => {
	let state = reduceCopyMode(initialCopyMode(), {type: 'enter', point: point(0)});
	state = reduceCopyMode(state, {type: 'move', x: 3, y: 4, point: point(5), extend: false});
	assert.equal(state.anchor?.offset, 5);
	assert.equal(state.focus?.offset, 5);
	assert.deepEqual(state.cursor, {x: 3, y: 4});
});

test('move with extend keeps anchor', () => {
	let state = reduceCopyMode(initialCopyMode(), {type: 'enter', point: point(2)});
	state = reduceCopyMode(state, {type: 'move', x: 0, y: 1, point: point(8), extend: true});
	assert.equal(state.anchor?.offset, 2);
	assert.equal(state.focus?.offset, 8);
});

test('exit clears selection', () => {
	let state = reduceCopyMode(initialCopyMode(), {type: 'enter', point: point(0)});
	state = reduceCopyMode(state, {type: 'exit'});
	assert.equal(state.active, false);
	assert.equal(state.anchor, undefined);
});

test('osc52Copy emits a valid OSC 52 sequence', () => {
	const seq = osc52Copy('hi');
	assert.equal(seq.startsWith('\u001b]52;c;'), true);
	assert.equal(seq.endsWith('\u0007'), true);
	const b64 = seq.slice('\u001b]52;c;'.length, -1);
	assert.equal(Buffer.from(b64, 'base64').toString('utf8'), 'hi');
});
