import test from 'node:test';
import assert from 'node:assert/strict';
import {
	initialScrollState,
	maxScrollTop,
	reduceScroll,
	type ScrollState
} from './transcriptScroll.js';

function state(partial: Partial<ScrollState> & Pick<ScrollState, 'scrollTop' | 'scrollHeight' | 'innerHeight'>): ScrollState {
	return {isSticking: true, ...partial};
}

test('maxScrollTop never goes negative', () => {
	assert.equal(maxScrollTop({scrollHeight: 5, innerHeight: 10}), 0);
	assert.equal(maxScrollTop({scrollHeight: 30, innerHeight: 10}), 20);
});

test('initial state sticks to bottom', () => {
	const s = initialScrollState(10, 40);
	assert.equal(s.isSticking, true);
	assert.equal(s.scrollTop, 30);
});

test('sticking content growth follows the new bottom', () => {
	let s = state({scrollTop: 20, scrollHeight: 30, innerHeight: 10, isSticking: true});
	s = reduceScroll(s, {type: 'content', scrollHeight: 50});
	assert.equal(s.isSticking, true);
	assert.equal(s.scrollTop, 40);
});

test('user scroll-up releases stick; later growth does not push viewport', () => {
	let s = state({scrollTop: 40, scrollHeight: 50, innerHeight: 10, isSticking: true});
	s = reduceScroll(s, {type: 'scrollBy', delta: -1});
	assert.equal(s.isSticking, false);
	assert.equal(s.scrollTop, 39);
	s = reduceScroll(s, {type: 'content', scrollHeight: 80});
	assert.equal(s.isSticking, false);
	assert.equal(s.scrollTop, 39);
});

test('wheel-up equivalent (scrollBy -3) releases stick-to-bottom', () => {
	let s = state({scrollTop: 40, scrollHeight: 50, innerHeight: 10, isSticking: true});
	s = reduceScroll(s, {type: 'scrollBy', delta: -3});
	assert.equal(s.isSticking, false);
	assert.equal(s.scrollTop, 37);
});

test('scrollToEnd restores stick', () => {
	let s = state({scrollTop: 10, scrollHeight: 50, innerHeight: 10, isSticking: false});
	s = reduceScroll(s, {type: 'scrollToEnd'});
	assert.equal(s.isSticking, true);
	assert.equal(s.scrollTop, 40);
});

test('content shrink clamps scrollTop', () => {
	let s = state({scrollTop: 40, scrollHeight: 50, innerHeight: 10, isSticking: false});
	s = reduceScroll(s, {type: 'content', scrollHeight: 20});
	assert.equal(s.scrollTop, 10);
});

test('resize while sticking keeps bottom', () => {
	let s = state({scrollTop: 40, scrollHeight: 50, innerHeight: 10, isSticking: true});
	s = reduceScroll(s, {type: 'resize', innerHeight: 20});
	assert.equal(s.isSticking, true);
	assert.equal(s.scrollTop, 30);
});

test('resize while not sticking preserves scrollTop when possible', () => {
	let s = state({scrollTop: 15, scrollHeight: 50, innerHeight: 10, isSticking: false});
	s = reduceScroll(s, {type: 'resize', innerHeight: 20});
	assert.equal(s.isSticking, false);
	assert.equal(s.scrollTop, 15);
});

test('forceStick (submit / approval) jumps to bottom', () => {
	let s = state({scrollTop: 5, scrollHeight: 50, innerHeight: 10, isSticking: false});
	s = reduceScroll(s, {type: 'forceStick'});
	assert.equal(s.isSticking, true);
	assert.equal(s.scrollTop, 40);
});

test('scrolling to the bottom re-enables stick', () => {
	let s = state({scrollTop: 10, scrollHeight: 50, innerHeight: 10, isSticking: false});
	s = reduceScroll(s, {type: 'scrollTo', scrollTop: 40});
	assert.equal(s.isSticking, true);
	assert.equal(s.scrollTop, 40);
});
