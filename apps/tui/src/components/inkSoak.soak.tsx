import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {Box} from 'ink';
import {render} from 'ink-testing-library';
import {ToolGroupMessage} from './tools/ToolGroupMessage.js';
import {ThemeProvider} from '../contexts/ThemeContext.js';
import type {ToolRun} from '../state/model.js';

function wrap(element: React.ReactElement) {
	return (
		<ThemeProvider themeName="no-color" setThemeName={() => undefined}>
			{element}
		</ThemeProvider>
	);
}

function createRng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

function buildSoakTool(index: number, rng: () => number): {tool: ToolRun; signature: string} {
	const signature = `SOAK-LONG-SIGN-${index}-${Math.floor(rng() * 10000)}`;
	const longPart = signature + '-' + 'z'.repeat(160 + Math.floor(rng() * 260));
	const shortPart = `SOAK-SHORT-${index}`;
	const out = rng() > 0.5 ? longPart : shortPart;
	const err = rng() > 0.4 ? `${signature}-ERR-${'e'.repeat(120)}` : `ERR-${index}`;
	const carriage = rng() > 0.5 ? `\rprogress-${index}` : '';

	return {
		tool: {
			id: 'shell_optional_soak',
			tool: 'shell',
			args: {command: `bash optional-soak-${index}.sh`},
			output: [
				{stream: 'stdout', text: `SOAK-MARK-${index} ${out}${carriage}\nstdout-${index}`},
				{stream: 'stderr', text: `SOAK-ERR-${index} ${err}\nstderr-${index}`}
			],
			status: 'success',
			fields: {exit: '0'}
		},
		signature
	};
}

test('Optional soak: long-session jitter 5000 rounds stays overlap-safe', () => {
	const rng = createRng(20260610);
	const first = buildSoakTool(0, rng);
	const app = render(
		wrap(
			<Box width={72}>
				<ToolGroupMessage expanded tools={[first.tool]} />
			</Box>
		)
	);

	let previousSignature = first.signature;
	for (let index = 1; index <= 5000; index += 1) {
		const next = buildSoakTool(index, rng);
		app.rerender(
			wrap(
				<Box width={72}>
					<ToolGroupMessage expanded tools={[next.tool]} />
				</Box>
			)
		);
		const raw = app.lastFrame() ?? '';
		const stdoutHasCarriage = next.tool.output[0]?.text.includes('\r') ?? false;
		assert.match(raw, stdoutHasCarriage ? new RegExp(`progress-${index}`) : new RegExp(`SOAK-MARK-${index}`));
		assert.match(raw, new RegExp(`SOAK-ERR-${index}`));
		assert.doesNotMatch(raw, /\u001b\[\?2026[hl]/);
		assert.doesNotMatch(raw, /\u001b\[K/);
		assert.doesNotMatch(raw, new RegExp(previousSignature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
		previousSignature = next.signature;
	}

	app.unmount();
});
