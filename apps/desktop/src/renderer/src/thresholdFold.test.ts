import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {TimelineItem} from '@fast-ide/session-view';
import {
	FILE_DIFF_FOLD_LINES,
	SHELL_OUTPUT_FOLD_LINES,
	fileDiffLineCount,
	outputLineCount,
	shouldThresholdFoldFile,
	shouldThresholdFoldTool
} from './thresholdFold.js';

type ToolItem = Extract<TimelineItem, {kind: 'tool'}>;
type FileItem = Extract<TimelineItem, {kind: 'file'}>;

function shell(lines: number, status: ToolItem['status'] = 'success'): ToolItem {
	return {
		kind: 'tool',
		id: 'shell-1',
		tool: 'shell',
		status,
		title: 'build',
		command: 'pnpm build',
		output: Array.from({length: lines}, (_, i) => `line ${i + 1}`).join('\n'),
		exitCode: '0',
		summary: null
	};
}

function file(
	lines: number,
	hidden: number,
	status: FileItem['status'] = 'success'
): FileItem {
	return {
		kind: 'file',
		id: 'file-1',
		path: 'src/a.ts',
		op: 'diff',
		status,
		add: 120,
		del: 90,
		lines: Array.from({length: lines}, (_, i) => ({
			type: 'add' as const,
			newLine: i + 1,
			content: `line ${i + 1}`
		})),
		hidden
	};
}

test('shell output folds only above the completed-output threshold', () => {
	assert.equal(outputLineCount(shell(SHELL_OUTPUT_FOLD_LINES).output), SHELL_OUTPUT_FOLD_LINES);
	assert.equal(shouldThresholdFoldTool(shell(SHELL_OUTPUT_FOLD_LINES)), false);
	assert.equal(shouldThresholdFoldTool(shell(SHELL_OUTPUT_FOLD_LINES + 1)), true);
});

test('running shell output never threshold-folds', () => {
	assert.equal(shouldThresholdFoldTool(shell(200, 'running')), false);
});

test('large non-shell tool output is not folded by the shell rule', () => {
	assert.equal(
		shouldThresholdFoldTool({...shell(200), tool: 'skill_view', command: null}),
		false
	);
});

test('file threshold uses capped preview plus hidden full-diff lines', () => {
	const exact = file(48, FILE_DIFF_FOLD_LINES - 48);
	assert.equal(fileDiffLineCount(exact), FILE_DIFF_FOLD_LINES);
	assert.equal(shouldThresholdFoldFile(exact), false);
	assert.equal(shouldThresholdFoldFile({...exact, hidden: exact.hidden + 1}), true);
});

test('running file diff never threshold-folds', () => {
	assert.equal(shouldThresholdFoldFile(file(48, 500, 'running')), false);
});
