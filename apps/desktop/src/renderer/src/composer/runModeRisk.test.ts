import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	isHighRiskRunMode,
	requiresRunModeConfirmation,
	runModeRiskSuffixKey
} from './runModeRisk.js';

test('isHighRiskRunMode only flags free mode', () => {
	assert.equal(isHighRiskRunMode('free'), true);
	assert.equal(isHighRiskRunMode('agent'), false);
	assert.equal(isHighRiskRunMode('plan'), false);
	assert.equal(isHighRiskRunMode('ask'), false);
	assert.equal(isHighRiskRunMode('yolo'), false);
});

test('requiresRunModeConfirmation triggers only when switching into free mode', () => {
	assert.equal(requiresRunModeConfirmation('agent', 'free'), true);
	assert.equal(requiresRunModeConfirmation('yolo', 'free'), true);
	assert.equal(requiresRunModeConfirmation('free', 'free'), false);
	assert.equal(requiresRunModeConfirmation('free', 'agent'), false);
	assert.equal(requiresRunModeConfirmation('agent', 'yolo'), false);
});

test('runModeRiskSuffixKey returns i18n key only for free mode', () => {
	assert.equal(runModeRiskSuffixKey('free'), 'shell.composer.freeModeRiskHint');
	assert.equal(runModeRiskSuffixKey('agent'), null);
	assert.equal(runModeRiskSuffixKey('yolo'), null);
});
