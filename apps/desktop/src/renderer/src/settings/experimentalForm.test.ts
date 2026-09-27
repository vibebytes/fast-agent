import assert from 'node:assert/strict';
import {test} from 'node:test';
import {experimentalForm} from './experimentalForm.js';

test('inactive extension hides the switch and the key field', () => {
	const view = experimentalForm({
		phaseActive: false,
		doc: {jevContext: true, eachTurn: true, secretId: 's1', last4: '5678'},
		draftOn: true,
		draftEachTurn: true,
		draftSecret: 'sk-12345678',
		clear: false
	});
	assert.equal(view.showSwitch, false);
	assert.equal(view.showEachTurn, false);
	assert.equal(view.showKey, false);
	assert.equal(view.save, null);
});

test('active with a missing document starts off and hides the key field', () => {
	const view = experimentalForm({
		phaseActive: true,
		doc: null,
		draftOn: false,
		draftEachTurn: false,
		draftSecret: '',
		clear: false
	});
	assert.equal(view.showSwitch, true);
	assert.equal(view.showEachTurn, false);
	assert.equal(view.switchOn, false);
	assert.equal(view.showKey, false);
	assert.deepEqual(view.save, {jevContext: false, eachTurn: false});
});

test('turning the switch on without a key does not write jevContext true', () => {
	const view = experimentalForm({
		phaseActive: true,
		doc: null,
		draftOn: true,
		draftEachTurn: true,
		draftSecret: '',
		clear: false
	});
	assert.equal(view.showKey, true);
	assert.equal(view.showEachTurn, true);
	assert.equal(view.save, null);
});

test('turning the switch on with a key submits that secret', () => {
	const view = experimentalForm({
		phaseActive: true,
		doc: null,
		draftOn: true,
		draftEachTurn: false,
		draftSecret: 'sk-12345678',
		clear: false
	});
	assert.deepEqual(view.save, {jevContext: true, eachTurn: false, secret: 'sk-12345678'});
	assert.equal(JSON.stringify(view.save).includes('general'), false);
});

test('an empty field keeps the existing secret id', () => {
	const view = experimentalForm({
		phaseActive: true,
		doc: {jevContext: false, eachTurn: false, secretId: 's1', last4: '5678'},
		draftOn: true,
		draftEachTurn: true,
		draftSecret: '   ',
		clear: false
	});
	assert.equal(view.last4, '5678');
	assert.deepEqual(view.save, {jevContext: true, eachTurn: true});
	assert.equal('secret' in (view.save ?? {}), false);
});

test('the main switch off stores eachTurn false', () => {
	const view = experimentalForm({
		phaseActive: true,
		doc: {jevContext: true, eachTurn: true, secretId: 's1', last4: '5678'},
		draftOn: false,
		draftEachTurn: true,
		draftSecret: '',
		clear: false
	});
	assert.equal(view.showEachTurn, false);
	assert.deepEqual(view.save, {jevContext: false, eachTurn: false});
});

test('clearing the key saves both switches off', () => {
	const view = experimentalForm({
		phaseActive: true,
		doc: {jevContext: true, eachTurn: true, secretId: 's1', last4: '5678'},
		draftOn: true,
		draftEachTurn: true,
		draftSecret: '',
		clear: true
	});
	assert.deepEqual(view.save, {jevContext: false, eachTurn: false, clearSecret: true});
});
