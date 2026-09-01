import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {render} from 'ink-testing-library';
import {CommandResultMessage} from './CommandResultMessage.js';
import {ThemeProvider} from '../contexts/ThemeContext.js';
import type {SystemTimelineItem} from '../state/timeline/model.js';

function renderCard(item: SystemTimelineItem): string {
	const app = render(
		<ThemeProvider themeName="default-dark" setThemeName={() => {}}>
			<CommandResultMessage item={item} />
		</ThemeProvider>
	);
	const frame = app.lastFrame() ?? '';
	app.unmount();
	return frame.replace(/\x1b\[[0-9;]*m/g, '');
}

test('CommandResultMessage expands multi-line menu by default', () => {
	const frame = renderCard({
		id: 'c1',
		kind: 'system_message',
		variant: 'command_result',
		commandName: 'skills',
		commandStatus: 'success',
		text: 'Skills (2)\n───\n  pptx\n  research'
	});
	assert.match(frame, /Skills \(2\)/);
	assert.match(frame, /pptx/);
	assert.match(frame, /research/);
	assert.doesNotMatch(frame, /folded/);
});

test('CommandResultMessage collapses menu to summary + folded count', () => {
	const frame = renderCard({
		id: 'c2',
		kind: 'system_message',
		variant: 'command_result',
		commandName: 'skills',
		commandStatus: 'success',
		collapsed: true,
		text: 'Skills (2)\n───\n  pptx\n  research'
	});
	assert.match(frame, /Skills \(2\)/);
	assert.match(frame, /folded/);
	assert.doesNotMatch(frame, /pptx/);
});
