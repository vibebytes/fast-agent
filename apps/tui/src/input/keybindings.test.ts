import test from 'node:test';
import assert from 'node:assert/strict';
import {Command, matchKeybinding, defaultKeybindings} from './keybindings.js';

test('matchKeybinding detects ctrl+c cancel', () => {
	const cmd = matchKeybinding({input: 'c', key: {ctrl: true}});
	assert.equal(cmd, Command.CANCEL_TASK);
});

test('arrow keys resolve to MOVE_UP/MOVE_DOWN (context decides history vs suggestions)', () => {
	assert.equal(matchKeybinding({input: '', key: {upArrow: true}}), Command.MOVE_UP);
	assert.equal(matchKeybinding({input: '', key: {downArrow: true}}), Command.MOVE_DOWN);
});

test('escape resolves to ESCAPE only — no shadowed CLEAR_INPUT alias', () => {
	assert.equal(matchKeybinding({input: '', key: {escape: true}}), Command.ESCAPE);
});

test('ctrl+u clears input, ctrl+r reverse search, tab accepts suggestion', () => {
	assert.equal(matchKeybinding({input: 'u', key: {ctrl: true}}), Command.CLEAR_INPUT);
	assert.equal(matchKeybinding({input: 'r', key: {ctrl: true}}), Command.REVERSE_SEARCH);
	assert.equal(matchKeybinding({input: '', key: {tab: true}}), Command.ACCEPT_SUGGESTION);
});

test('enter submits, shift+enter is newline', () => {
	assert.equal(matchKeybinding({input: '', key: {return: true}}), Command.RETURN);
	assert.equal(matchKeybinding({input: '', key: {return: true, shift: true}}), Command.NEWLINE);
});

test('no key ever resolves to two different commands (bindings are unambiguous)', () => {
	const probes: Array<{input: string; key: Record<string, boolean>}> = [
		{input: '', key: {upArrow: true}},
		{input: '', key: {downArrow: true}},
		{input: '', key: {escape: true}},
		{input: '', key: {tab: true}},
		{input: '', key: {return: true}},
		{input: 'c', key: {ctrl: true}},
		{input: 'u', key: {ctrl: true}},
		{input: 'r', key: {ctrl: true}},
		{input: 'o', key: {ctrl: true}},
		{input: 'h', key: {ctrl: true}},
		{input: 'f', key: {ctrl: true}},
	];
	for (const probe of probes) {
		const hits = defaultKeybindings.filter(binding => binding.match(probe));
		assert.ok(hits.length <= 1, `ambiguous binding for ${JSON.stringify(probe)}: ${hits.map(h => h.command).join(', ')}`);
	}
});
