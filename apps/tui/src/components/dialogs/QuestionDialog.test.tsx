import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {QuestionDialog} from './QuestionDialog.js';
import {renderWithProviders, plainFrame, waitForFrame, pressUntil} from '../../test-utils/render.js';
import {initialState} from '../../state/model.js';
import type {UserQuestion} from '../../state/model.js';

const question: UserQuestion = {
	id: 'question_1',
	runId: 'run_1',
	turnId: 'turn_1',
	title: 'Project Location',
	question: 'Where should I create the project?',
	options: [
		{id: 'new_dir', label: 'New directory', recommended: true},
		{id: 'current', label: 'Current directory'}
	],
	allowCustom: true,
	allowChat: false
};

type Answer = string | {selectedOptionId?: string; customText?: string};

test('QuestionDialog renders title and question text', () => {
	const state = {...initialState, ready: true, inputMode: 'question' as const};
	const app = renderWithProviders(
		<QuestionDialog question={question} onAnswer={() => {}} />,
		{state}
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /Project Location/);
	assert.match(frame, /Where should I create the project/);
	app.unmount();
});

test('QuestionDialog renders all options including custom', () => {
	const state = {...initialState, ready: true, inputMode: 'question' as const};
	const app = renderWithProviders(
		<QuestionDialog question={question} onAnswer={() => {}} />,
		{state}
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /New directory/);
	assert.match(frame, /Current directory/);
	assert.match(frame, /Type something/);
	app.unmount();
});

const tick = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));

test('QuestionDialog preselects the recommended option and Enter answers it', async () => {
	const answers: Array<[string, Answer]> = [];
	const state = {...initialState, ready: true, inputMode: 'question' as const};
	const app = renderWithProviders(
		<QuestionDialog question={question} onAnswer={(id, text) => answers.push([id, text])} />,
		{state}
	);

	assert.match(plainFrame(app.lastFrame()), /❯ 1\. New directory/, 'recommended option preselected');
	app.stdin.write('\r');
	await tick();
	assert.deepEqual(answers, [['question_1', {selectedOptionId: 'new_dir'}]]);
	app.unmount();
});

test('QuestionDialog arrow keys move selection before Enter', async () => {
	const answers: Array<[string, Answer]> = [];
	const state = {...initialState, ready: true, inputMode: 'question' as const};
	const app = renderWithProviders(
		<QuestionDialog question={question} onAnswer={(id, text) => answers.push([id, text])} />,
		{state}
	);
	await tick();

	const onCurrent = (frame: string) => /❯ 2\. Current directory/.test(frame);
	for (let round = 0; round < 5; round++) {
		await pressUntil(app, '\u001B[B', onCurrent, 'highlight reaches Current directory');
		await new Promise(resolve => setTimeout(resolve, 150));
		if (onCurrent(plainFrame(app.lastFrame()))) break;
	}
	assert.ok(onCurrent(plainFrame(app.lastFrame())), 'selection settled on Current directory');

	app.stdin.write('\r');
	await waitForFrame(app, () => answers.length > 0, 'Enter answer');
	assert.deepEqual(answers, [['question_1', {selectedOptionId: 'current'}]]);
	app.unmount();
});

test('QuestionDialog numeric shortcut answers immediately', async () => {
	const answers: Array<[string, Answer]> = [];
	const state = {...initialState, ready: true, inputMode: 'question' as const};
	const app = renderWithProviders(
		<QuestionDialog question={question} onAnswer={(id, text) => answers.push([id, text])} />,
		{state}
	);
	await tick();

	app.stdin.write('2');
	await tick();
	assert.deepEqual(answers, [['question_1', {selectedOptionId: 'current'}]]);
	app.unmount();
});

test('QuestionDialog shows no-options fallback when options empty', () => {
	const emptyQuestion: UserQuestion = {
		...question,
		options: [],
		allowCustom: false,
		allowChat: false
	};
	const state = {...initialState, ready: true, inputMode: 'question' as const};
	const app = renderWithProviders(
		<QuestionDialog question={emptyQuestion} onAnswer={() => {}} />,
		{state}
	);
	const frame = plainFrame(app.lastFrame());
	assert.match(frame, /No predefined options/);
	app.unmount();
});
