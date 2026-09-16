import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	chromeEngineKind,
	enginePickerKinds,
	rememberEnginePick,
	rememberedEnginePick,
	shouldResyncChrome
} from './enginePicker.js';

test('enginePickerKinds empty / fast / fast+dsh', () => {
	assert.deepEqual(enginePickerKinds([]), []);
	assert.deepEqual(enginePickerKinds(['fast']), ['fast']);
	assert.deepEqual(enginePickerKinds(['fast', 'dsh']), ['fast', 'dsh']);
	assert.deepEqual(enginePickerKinds(['DSH', 'fast']), ['fast', 'dsh']);
	assert.deepEqual(enginePickerKinds(['example']), []);
});

test('shouldResyncChrome only fires on a Task identity change', () => {
	assert.equal(shouldResyncChrome('t1', 't2'), true);
	assert.equal(shouldResyncChrome(null, 't1'), true);
	assert.equal(shouldResyncChrome('t1', null), true);
	assert.equal(shouldResyncChrome(undefined, 't1'), true);
});

test('shouldResyncChrome never fires for a same-Task prop change', () => {
	// The regression: a sticky* prop change on the same Task must not clobber
	// the optimistic pickEngine, including engineKind (picker fast, session ran dsh).
	assert.equal(shouldResyncChrome('t1', 't1'), false);
	assert.equal(shouldResyncChrome(null, null), false);
	assert.equal(shouldResyncChrome(undefined, undefined), false);
	assert.equal(shouldResyncChrome(undefined, null), false);
});

test('chromeEngineKind keeps an owned dsh pick when sticky chrome is still fast', () => {
	rememberEnginePick('t-dsh', 'dsh');
	assert.equal(rememberedEnginePick('t-dsh'), 'dsh');
	assert.equal(chromeEngineKind('t-dsh', 'fast'), 'dsh');
	assert.equal(chromeEngineKind('other', 'fast'), 'fast');
	rememberEnginePick('t-dsh', 'fast');
	assert.equal(chromeEngineKind('t-dsh', 'dsh'), 'fast');
});
