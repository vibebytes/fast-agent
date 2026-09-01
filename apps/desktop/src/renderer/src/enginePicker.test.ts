import assert from 'node:assert/strict';
import {test} from 'node:test';
import {enginePickerKinds} from './enginePicker.js';

test('enginePickerKinds empty / fast / fast+dsh', () => {
	assert.deepEqual(enginePickerKinds([]), []);
	assert.deepEqual(enginePickerKinds(['fast']), ['fast']);
	assert.deepEqual(enginePickerKinds(['fast', 'dsh']), ['fast', 'dsh']);
	assert.deepEqual(enginePickerKinds(['DSH', 'fast']), ['fast', 'dsh']);
	assert.deepEqual(enginePickerKinds(['example']), []);
});
