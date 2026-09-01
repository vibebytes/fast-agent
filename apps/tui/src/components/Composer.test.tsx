import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {Composer} from './Composer.js';
import {renderWithProviders, plainFrame, waitForFrame, pressUntil} from '../test-utils/render.js';
import {initialState} from '../state/model.js';

test('Composer renders normal prompt when ready', () => {
	const state = {...initialState, ready: true, inputMode: 'normal' as const};
	const app = renderWithProviders(
		<Composer ready mode="normal" onClearQueue={() => {}} onSubmit={() => {}} />,
		{state}
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, />/);
	app.unmount();
});

test('Composer renders approval prompt', () => {
	const state = {...initialState, ready: true, inputMode: 'approval' as const};
	const app = renderWithProviders(
		<Composer ready mode="approval" onClearQueue={() => {}} onSubmit={() => {}} />,
		{state}
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /confirm>/);
	app.unmount();
});

test('Composer renders question prompt', () => {
	const state = {...initialState, ready: true, inputMode: 'question' as const};
	const app = renderWithProviders(
		<Composer ready mode="question" onClearQueue={() => {}} onSubmit={() => {}} />,
		{state}
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /choice>/);
	app.unmount();
});

const tick = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));

test('Composer typing + Enter submits trimmed text and clears the input', async () => {
	const submitted: string[] = [];
	const state = {...initialState, ready: true, inputMode: 'normal' as const};
	const app = renderWithProviders(
		<Composer ready mode="normal" onClearQueue={() => {}} onSubmit={value => submitted.push(value)} />,
		{state}
	);
	await waitForFrame(app, frame => frame.includes('>'), 'composer input');

	app.stdin.write('  hello world  ');
	await waitForFrame(app, frame => /hello world/.test(frame), 'typed text visible');
	// Retried Enter: a keypress can land in ink's re-subscribe gap and vanish.
	// Extra presses are harmless — the input is empty once submission happened.
	await pressUntil(app, '\r', () => submitted.length > 0, 'Enter submission');

	assert.deepEqual(submitted, ['hello world']);
	await waitForFrame(app, frame => !/hello world/.test(frame), 'input cleared after submit');
	app.unmount();
});

test('Composer up/down arrows navigate input history and restore the draft', async () => {
	const state = {...initialState, ready: true, inputMode: 'normal' as const};
	const app = renderWithProviders(
		<Composer ready mode="normal" onClearQueue={() => {}} onSubmit={() => {}} />,
		{state, history: ['first command', 'second command']}
	);
	// A frame on screen means the mount commit (and its useInput subscription
	// effect) has flushed, so keystrokes from here on are reliably delivered.
	await waitForFrame(app, frame => frame.includes('>'), 'composer input');

	app.stdin.write('my draft');
	await waitForFrame(app, frame => /my draft/.test(frame), 'typed draft');

	app.stdin.write('\u001B[A'); // up → most recent entry
	await waitForFrame(app, frame => /second command/.test(frame), 'history: most recent entry');

	app.stdin.write('\u001B[A'); // up → older entry
	await waitForFrame(app, frame => /first command/.test(frame), 'history: older entry');

	app.stdin.write('\u001B[B'); // down → back to recent
	await waitForFrame(app, frame => /second command/.test(frame), 'history: back to recent');

	app.stdin.write('\u001B[B'); // down past the end → draft restored
	await waitForFrame(app, frame => /my draft/.test(frame), 'history: draft restored');
	app.unmount();
});

test('Composer slash input shows suggestions and Tab accepts the active one', async () => {
	const state = {...initialState, ready: true, inputMode: 'normal' as const};
	const app = renderWithProviders(
		<Composer ready mode="normal" onClearQueue={() => {}} onSubmit={() => {}} />,
		{state}
	);
	await tick();

	app.stdin.write('/hel');
	await tick();
	assert.match(plainFrame(app.lastFrame()), /help/);

	app.stdin.write('\t');
	await tick();
	assert.match(plainFrame(app.lastFrame()), /\/help/);
	app.unmount();
});

test('Composer arrow-navigating suggestions updates input to show the selected command', async () => {
	const state = {...initialState, ready: true, inputMode: 'normal' as const};
	const app = renderWithProviders(
		<Composer ready mode="normal" onClearQueue={() => {}} onSubmit={() => {}} />,
		{state}
	);
	await waitForFrame(app, frame => frame.includes('>'), 'composer input');

	app.stdin.write('/');
	await waitForFrame(app, frame => /Commands/.test(frame), 'suggestion list');

	// Any selection beyond the bare "/" satisfies the contract, so retried
	// presses (down → further down) are harmless.
	await pressUntil(app, '\u001B[B',
		frame => /> \/\S+/.test(frame.split('\n').find(line => line.includes('> /')) ?? ''),
		'input shows an arrow-selected command');
	app.unmount();
});

test('Composer Esc during suggestion navigation restores original typed text', async () => {
	const state = {...initialState, ready: true, inputMode: 'normal' as const};
	const app = renderWithProviders(
		<Composer ready mode="normal" onClearQueue={() => {}} onSubmit={() => {}} />,
		{state}
	);
	// The composer input row is the bordered `│ > … │` line; the suggestion
	// list marks its active row with '❯ ', so '> /' uniquely finds the input.
	const inputLine = (frame: string) => frame.split('\n').find(line => line.includes('> /')) ?? '';

	await waitForFrame(app, frame => frame.includes('>'), 'composer input');

	app.stdin.write('/cl');
	await waitForFrame(app, frame => /clear/.test(frame), 'clear command suggestions');

	// down until the input mirrors a selection LONGER than the typed '/cl' —
	// a bare '> /…' predicate would match the typed text itself and return
	// before the selection state ever committed. Extra retried presses only
	// move deeper in the list, which is still a selection.
	await pressUntil(app, '\u001B[B',
		frame => /\/cl[\w-]+/.test(inputLine(frame)),
		'arrow selection mirrored into input');

	// The mirror rendered, so the selection state is committed; this single
	// Esc cannot hit the stale-closure window that batched down+Esc keypresses
	// race into (Esc reading suggestionDraft=null skips the draft restore).
	app.stdin.write('\u001B');
	await waitForFrame(app, frame => {
		const line = inputLine(frame);
		return line.includes('/cl') && !/\/cl[\w-]/.test(line);
	}, 'original typed text /cl restored');
	app.unmount();
});

test('Composer arrow-select "/model" then Enter submits /model, not the typed partial', async () => {
	// The pinned regression: Enter after arrow-selecting a suggestion must
	// submit the SELECTED command, not the literal typed text. Typing "/mode"
	// matches both /mode and /model, so ONE down-press (retried until visible)
	// lands the selection on /model.
	const {buildSuggestions, flattenSuggestions} = await import('../suggestions/SuggestionEngine.js');
	const {createCommandRegistry} = await import('../commands/registry.js');
	const flat = flattenSuggestions(buildSuggestions({
		partial: '/mode',
		commands: createCommandRegistry().commands,
		history: [],
		cwd: '',
		model: ''
	}));
	assert.deepEqual(flat.map(s => s.value), ['/mode', '/model'], '"/mode" should match /mode and /model');

	const submitted: string[] = [];
	const state = {...initialState, ready: true, inputMode: 'normal' as const};
	const app = renderWithProviders(
		<Composer ready mode="normal" onClearQueue={() => {}} onSubmit={value => submitted.push(value)} />,
		{state}
	);
	await waitForFrame(app, frame => frame.includes('>'), 'composer input');

	app.stdin.write('/mode');
	await waitForFrame(app, frame => /model/.test(frame), 'suggestion list for /mode');

	await pressUntil(app, '\u001B[B',
		frame => /> \/model\b/.test(frame.split('\n').find(line => line.includes('> /')) ?? ''),
		'arrow selection reaches /model');

	app.stdin.write('\r');
	await waitForFrame(app, () => submitted.length > 0, 'Enter submission');

	assert.deepEqual(submitted, ['/model'], 'Enter should submit /model, not the typed /mode');
	app.unmount();
});

test('Composer Ctrl+U clears typed input', async () => {
	const state = {...initialState, ready: true, inputMode: 'normal' as const};
	const app = renderWithProviders(
		<Composer ready mode="normal" onClearQueue={() => {}} onSubmit={() => {}} />,
		{state}
	);
	await tick();

	app.stdin.write('half typed');
	await tick();
	assert.match(plainFrame(app.lastFrame()), /half typed/);

	app.stdin.write('\u0015'); // Ctrl+U
	await tick();
	assert.doesNotMatch(plainFrame(app.lastFrame()), /half typed/);
	app.unmount();
});

test('Composer Esc clears typed input (matches the Ctrl+U / Esc shortcut label)', async () => {
	const state = {...initialState, ready: true, inputMode: 'normal' as const};
	const app = renderWithProviders(
		<Composer ready mode="normal" onClearQueue={() => {}} onSubmit={() => {}} />,
		{state}
	);
	await tick();

	app.stdin.write('abandon this');
	await tick();
	app.stdin.write('\u001B'); // Esc
	await tick(150);
	assert.doesNotMatch(plainFrame(app.lastFrame()), /abandon this/);
	app.unmount();
});

test('Composer Esc first dismisses the suggestion list, keeping the input', async () => {
	const state = {...initialState, ready: true, inputMode: 'normal' as const};
	const app = renderWithProviders(
		<Composer ready mode="normal" onClearQueue={() => {}} onSubmit={() => {}} />,
		{state}
	);
	await tick();

	app.stdin.write('/mod');
	await tick();
	assert.match(plainFrame(app.lastFrame()), /model/);

	app.stdin.write('\u001B');
	await tick(150);
	const frame = plainFrame(app.lastFrame());
	assert.match(frame, /\/mod/, 'typed text must survive the first Esc');
	app.unmount();
});

test('Composer Ctrl+U on empty input clears the queue instead', async () => {
	let cleared = 0;
	const state = {...initialState, ready: true, inputMode: 'queued' as const};
	const app = renderWithProviders(
		<Composer ready mode="queued" onClearQueue={() => { cleared += 1; }} onSubmit={() => {}} />,
		{state}
	);
	await tick();

	app.stdin.write('\u0015');
	await tick();
	assert.equal(cleared, 1);
	app.unmount();
});

test('Composer inserts a newline via \\n and submits the full multiline on Enter', async () => {
	const submitted: string[] = [];
	const state = {...initialState, ready: true, inputMode: 'normal' as const};
	const app = renderWithProviders(
		<Composer ready mode="normal" onClearQueue={() => {}} onSubmit={value => submitted.push(value)} />,
		{state}
	);
	await waitForFrame(app, frame => frame.includes('>'), 'composer input');

	app.stdin.write('line1');
	// Raw \\n is parsed as name "enter" (not return) and inserted as text.
	app.stdin.write('\n');
	app.stdin.write('line2');
	await waitForFrame(app, frame => /line1/.test(frame) && /line2/.test(frame), 'multiline visible');

	await pressUntil(app, '\r', () => submitted.length > 0, 'Enter submits multiline');
	assert.deepEqual(submitted, ['line1\nline2']);
	app.unmount();
});

test('Composer renders spinner when not ready', () => {
	const state = {...initialState, ready: false, inputMode: 'starting' as const};
	const app = renderWithProviders(
		<Composer ready={false} mode="starting" onClearQueue={() => {}} onSubmit={() => {}} />,
		{state}
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /引擎启动中|starting|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/i);
	app.unmount();
});
