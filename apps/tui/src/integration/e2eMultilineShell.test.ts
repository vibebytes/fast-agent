/**
 * E2E: Multi-line shell command — the LLM issues one Shell tool call whose
 * command spans several lines. Regression guard for the card-misalignment
 * fix: continuation lines must render as indented rows INSIDE the tool card
 * instead of tearing the border.
 *
 * Fixture recorded from the real engine + LLM (see FAST_E2E_RECORD_EVENTS
 * in helpers/e2eHarness.ts); replays deterministically afterwards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordedReplayHarness, gracefulExit, shellToolPrompt} from './helpers/e2eHarness.js';

const SCRIPT = 'echo "MULTILINE-STEP-ONE"\necho "MULTILINE-STEP-TWO"\necho "MULTILINE-OK-FINAL"';

test('E2E multi-line shell: script rows stay inside the tool card', {timeout: 300_000}, async t => {
	const h = await createRecordedReplayHarness(t, 'recorded-multiline-shell.jsonl');
	if (!h) return;

	try {
		await h.waitFor(() => h.transcript.includes('输入消息'), 'ready prompt', 120_000);

		await h.submit(shellToolPrompt(SCRIPT, '注意：command 是一个三行的多行脚本，必须一次性放进同一个 Shell 调用。'));

		await h.waitForScreen(/Do you want to proceed/, 'approval dialog', 180_000);
		await new Promise(resolve => setTimeout(resolve, 300));
		h.write('y');

		await h.waitForScreen('MULTILINE-OK-FINAL', 'multi-line tool output', 180_000);
		await h.waitForIdle();

		const screen = await h.screenText();
		const lines = screen.split('\n');
		// Locate the tool card: its header row carries `$ echo "MULTILINE-STEP-ONE"`
		// INSIDE the border. (The user-message echo of the prompt also contains the
		// script — borderless by design — so anchor on the `$ ` header.)
		const headerIndex = lines.findIndex(line => /│.*\$ echo "MULTILINE-STEP-ONE"/.test(line));
		assert.ok(headerIndex >= 0, `tool card header not found; screen:\n${screen.slice(-3000)}`);
		const cardEnd = lines.findIndex((line, index) => index > headerIndex && line.includes('╰'));
		assert.ok(cardEnd > headerIndex, 'tool card has a closing border');
		const card = lines.slice(headerIndex, cardEnd);
		// Continuation script rows render INSIDE the card, bordered on both sides.
		// PTY/xterm may append a block cursor (█) after the closing border — strip
		// that before asserting both borders are present.
		const stripPtyChrome = (line: string) => line.replace(/[█▀▄]+$/g, '').trimEnd();
		const stepTwo = card.find(line => line.includes('MULTILINE-STEP-TWO') && line.includes('echo'));
		assert.ok(stepTwo, 'second script line rendered inside the tool card');
		assert.match(stripPtyChrome(stepTwo), /^\s*│.*│\s*$/, `script row escaped the card border: "${stepTwo}"`);
		for (const line of card) {
			assert.match(stripPtyChrome(line), /^\s*│.*│\s*$/, `card row lost its border: "${line}"`);
		}
		assert.doesNotMatch(screen, /\u001b\[/, 'no raw ANSI escapes');

		const exitCode = await gracefulExit(h);
		assert.equal(exitCode, 0, 'clean exit');
	} finally {
		h.cleanup();
	}
});
