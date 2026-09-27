import assert from 'node:assert/strict';
import {test} from 'node:test';
import {experimentalForm} from './experimentalForm.js';

test('inactive extension hides the switch and the key field', () => {
	const view = experimentalForm({
		phaseActive: false,
		doc: {jevContext: true, secretId: 's1', last4: '5678'},
		draftOn: true,
		draftSecret: 'sk-12345678',
		clear: false
	});
	assert.equal(view.showSwitch, false);
	assert.equal(view.showKey, false);
	assert.equal(view.save, null);
});

test('active with a missing document starts off and hides the key field', () => {
	const view = experimentalForm({
		phaseActive: true,
		doc: null,
		draftOn: false,
		draftSecret: '',
		clear: false
	});
	assert.equal(view.showSwitch, true);
	assert.equal(view.switchOn, false);
	assert.equal(view.showKey, false);
	assert.deepEqual(view.save, {jevContext: false});
});

test('turning the switch on without a key does not write jevContext true', () => {
	const view = experimentalForm({
		phaseActive: true,
		doc: null,
		draftOn: true,
		draftSecret: '',
		clear: false
	});
	assert.equal(view.showKey, true);
	assert.equal(view.save, null);
});

test('turning the switch on with a key submits that secret', () => {
	const view = experimentalForm({
		phaseActive: true,
		doc: null,
		draftOn: true,
		draftSecret: 'sk-12345678',
		clear: false
	});
	assert.deepEqual(view.save, {jevContext: true, secret: 'sk-12345678'});
	assert.equal(JSON.stringify(view.save).includes('general'), false);
});

test('an empty field keeps the existing secret id', () => {
	const view = experimentalForm({
		phaseActive: true,
		doc: {jevContext: false, secretId: 's1', last4: '5678'},
		draftOn: true,
		draftSecret: '   ',
		clear: false
	});
	assert.equal(view.last4, '5678');
	assert.deepEqual(view.save, {jevContext: true});
	assert.equal('secret' in (view.save ?? {}), false);
});

test('clearing the key saves the switch off', () => {
	const view = experimentalForm({
		phaseActive: true,
		doc: {jevContext: true, secretId: 's1', last4: '5678'},
		draftOn: true,
		draftSecret: '',
		clear: true
	});
	assert.deepEqual(view.save, {jevContext: false, clearSecret: true});
});
