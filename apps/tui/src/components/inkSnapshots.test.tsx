import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {MainContent} from './MainContent.js';
import {AppHeader} from './AppHeader.js';
import {ToolGroupMessage} from './tools/ToolGroupMessage.js';
import {ApprovalDialog} from './dialogs/ApprovalDialog.js';
import {QuestionDialog} from './dialogs/QuestionDialog.js';
import {Footer} from './Footer.js';
import {HelpDialog} from './dialogs/HelpDialog.js';
import {ThemeDialog} from './dialogs/ThemeDialog.js';
import {FooterConfigDialog} from './dialogs/FooterConfigDialog.js';
import {Composer} from './Composer.js';
import {defaultFooterConfig, initialState, type UiState} from '../state/model.js';
import {reducer} from '../state/reducer.js';
import {renderWithProviders, plainFrame} from '../test-utils/render.js';

function readyState(patch: Partial<UiState> = {}): UiState {
	return {
		...initialState,
		ready: true,
		inputMode: 'normal',
		status: 'ready',
		model: 'default',
		modelDisplay: 'default -> deepseek-reasoner',
		cwd: '/tmp/workspace',
		...patch
	};
}

const noopDrift = () => undefined;

test('Ink snapshot: MainContent empty ready state', () => {
	const state = readyState();
	const app = renderWithProviders(
		<MainContent state={state} staticEpoch={0} onStaticDrift={noopDrift} />,
		{state}
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /输入消息，或 \/help 查看命令/);
	app.unmount();
});

test('Ink snapshot: AppHeader renders the startup banner once', () => {
	const state = readyState();
	const app = renderWithProviders(<AppHeader />, {state});
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /fast-ink/);
	assert.match(frame, /v0\.2\.0-SNAPSHOT/);
	assert.match(frame, /\/help/);
	app.unmount();
});

test('Ink snapshot: MainContent separates command result from answer', () => {
	const state = readyState({
		transcript: {
			...initialState.transcript,
			entries: [{
				id: 'entry_1',
				role: 'assistant',
				text: '模型列表已经展示完毕。',
				status: 'done',
				turnId: 'turn_1'
			}]
		},
		localTurns: [{
			id: 'turn_1',
			userText: '/model',
			thinking: '',
			assistantText: '',
			tools: [],
			files: [],
			systemMessages: [{
				id: 'command_1',
				role: 'system',
				text: 'Current model: default\n\ndeepseek\ndeepseek-reasoner\nopenai',
				kind: 'command_result',
				commandName: 'model',
				commandStatus: 'success'
			}],
			segments: [{kind: 'system', id: 'seg-command_1', messageId: 'command_1'}],
			status: 'success',
			tokensUsed: 0,
			streamSeq: 0
		}]
	});
	const app = renderWithProviders(
		<MainContent state={state} staticEpoch={0} onStaticDrift={noopDrift} />,
		{state}
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /\/model command result/);
	assert.match(frame, /Current model: default/);
	assert.match(frame, /deepseek-reasoner/);
	assert.match(frame, /✦\s+模型列表已经展示完毕。/);
	app.unmount();
});

test('Ink snapshot: MainContent separates pending question', () => {
	const state = readyState({
		transcript: {
			...initialState.transcript,
			entries: [{
				id: 'entry_1',
				role: 'assistant',
				text: '',
				reasoning: 'checking files',
				status: 'streaming',
				turnId: 'turn_1',
				segments: [{kind: 'thinking', id: 'seg_t', text: 'checking files'}]
			}],
			questions: [{
				id: 'question_1',
				runId: 'turn_1',
				title: 'Location',
				question: 'Where should I create it?',
				options: [{id: 'new', label: 'New directory'}],
				allowCustom: true
			}]
		}
	});
	const app = renderWithProviders(
		<MainContent state={state} staticEpoch={0} onStaticDrift={noopDrift} />,
		{state}
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /Thinking/);
	assert.match(frame, /Location/);
	assert.match(frame, /Where should I create it\?/);
	assert.match(frame, /❯ 1\. New directory/);
	app.unmount();
});

test('Ink snapshot: Shell tool group renders command and streams', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			expanded
			tools={[{
				id: 'shell_1',
				tool: 'shell',
				args: {command: 'npm test'},
				output: [
					{stream: 'stdout', text: 'ok 1\nok 2'},
					{stream: 'stderr', text: 'warning: slow test'}
				],
				status: 'success',
				fields: {exit: '0', duration: '120ms'}
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	// Card layout: status icon + `$` prompt inside a rounded border; the
	// border replaces the old `⎿` elbow and the `shell` label.
	assert.match(frame, /✓ \$ npm test/);
	assert.match(frame, /│ ok 1/);
	assert.match(frame, /╭─/);
	assert.match(frame, /╰─/);
	assert.match(frame, /warning: slow test/);
	assert.match(frame, /120ms/);
	// Success is conveyed by the icon; no uppercase noise, no exit-0 spam.
	assert.doesNotMatch(frame, /SUCCESS/);
	assert.doesNotMatch(frame, /exit 0/);
	app.unmount();
});

test('Ink snapshot: multi-line shell command renders as script rows inside the card', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			expanded
			tools={[{
				id: 'shell_script',
				tool: 'shell',
				args: {command: 'pkill -f "vite" 2>/dev/null; cd frontend && npx vite --port 3000 &\nsleep 3\ncurl -s http://localhost:3000'},
				output: [{stream: 'stdout', text: 'VITE ready in 163 ms'}],
				status: 'success',
				fields: {exit: '0'}
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());
	const lines = frame.split('\n').filter(line => line.trim().length > 0);

	// Header keeps only the first script line; continuations are own rows.
	assert.match(frame, /\$ pkill -f "vite"/);
	assert.match(frame, /sleep 3/);
	assert.match(frame, /curl -s http:\/\/localhost:3000/);
	assert.match(frame, /VITE ready in 163 ms/);
	// Every content row stays inside the card: bordered left AND right.
	for (const line of lines) {
		if (/pkill|sleep 3|curl|VITE ready/.test(line)) {
			assert.match(line, /^\s*│.*│\s*$/, `row escaped the card border: "${line}"`);
		}
	}
	app.unmount();
});

test('Ink snapshot: running shell shows a live tail of its output', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			expanded
			tools={[{
				id: 'shell_run',
				tool: 'shell',
				args: {command: 'npm install'},
				output: [{stream: 'stdout', text: 'fetching packages\nresolving deps'}],
				status: 'running',
				fields: {}
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	// Live tail (last 2 lines), claude-code style — not a dead "running…" row.
	assert.match(frame, /fetching packages/);
	assert.match(frame, /resolving deps/);
	assert.doesNotMatch(frame, /运行中…/);
	// No collapsed-lines hint while still running.
	assert.doesNotMatch(frame, /行已折叠/);
	app.unmount();
});

test('Ink snapshot: running shell without output falls back to the status line', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			expanded
			tools={[{
				id: 'shell_run_quiet',
				tool: 'shell',
				args: {command: 'sleep 5'},
				output: [],
				status: 'running',
				fields: {}
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /运行中…/);
	app.unmount();
});

test('Ink snapshot: running shell shows live elapsed seconds in the suffix slot', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			expanded
			tools={[{
				id: 'shell_run_elapsed',
				tool: 'shell',
				args: {command: 'npm install'},
				output: [{stream: 'stdout', text: 'fetching packages'}],
				status: 'running',
				fields: {},
				startedAt: Date.now() - 27_000
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /\$ npm install\s+2[78]s/, 'elapsed seconds tick in the header suffix');
	app.unmount();
});

test('Ink snapshot: silent running shell reports elapsed time without output', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			expanded
			tools={[{
				id: 'shell_run_silent',
				tool: 'shell',
				args: {command: 'npm install'},
				output: [],
				status: 'running',
				fields: {},
				startedAt: Date.now() - 15_000
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /运行中… 1[56]s 无输出/, 'silent-period hint after 10s');
	app.unmount();
});

test('Ink snapshot: successful shell previews the TAIL with the fold hint above', () => {
	const noise = Array.from({length: 20}, (_, i) => `progress line ${i}`).join('\n');
	const app = renderWithProviders(
		<ToolGroupMessage
			tools={[{
				id: 'shell_success_tail',
				tool: 'shell',
				args: {command: 'npm install'},
				output: [
					{stream: 'stdout', text: noise},
					{stream: 'stdout', text: 'added 1361 packages in 47s'}
				],
				status: 'success',
				fields: {exit: '0', duration: '47s'}
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	// Tail (the conclusion) is visible; head noise folds behind the hint.
	assert.match(frame, /added 1361 packages in 47s/);
	assert.doesNotMatch(frame, /progress line 0\b/);
	assert.match(frame, /… \+\d+ 行/);
	const hintIndex = frame.indexOf('… +');
	const tailIndex = frame.indexOf('added 1361 packages');
	assert.ok(hintIndex >= 0 && hintIndex < tailIndex, 'fold hint renders above the tail preview');
	app.unmount();
});

test('Ink snapshot: failed shell with no output shows an explicit empty marker', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			tools={[{
				id: 'shell_silent_fail',
				tool: 'shell',
				args: {command: 'top -l 1 2>/dev/null'},
				output: [],
				status: 'failed',
				fields: {exit: '127'}
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /exit 127/);
	assert.match(frame, /\(无输出\)/);
	app.unmount();
});

test('Ink snapshot: failed shell always shows the error tail, never a silent ✗', () => {
	const noise = Array.from({length: 20}, (_, i) => `compiling module ${i}`).join('\n');
	const app = renderWithProviders(
		<ToolGroupMessage
			tools={[{
				id: 'shell_fail',
				tool: 'shell',
				args: {command: 'npm run build'},
				output: [
					{stream: 'stdout', text: noise},
					{stream: 'stderr', text: 'error TS2304: Cannot find name "foo"\nbuild failed'}
				],
				status: 'failed',
				fields: {exit: '1'}
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	// Header: ✗ + command + exit code, no uppercase FAILED noise.
	assert.match(frame, /✗ \$ npm run build/);
	assert.match(frame, /exit 1/);
	assert.doesNotMatch(frame, /FAILED/);
	// The TAIL (actual error) is visible even though the tool is collapsed;
	// the head noise is folded behind the slim hint (Ctrl+O teaching lives in
	// the aggregate overflow hint, not on every block).
	assert.match(frame, /error TS2304/);
	assert.match(frame, /build failed/);
	assert.doesNotMatch(frame, /compiling module 0/);
	assert.match(frame, /… \+\d+ 行/);
	app.unmount();
});

test('Ink snapshot: denied shell is labeled 已拒绝', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			tools={[{
				id: 'shell_denied',
				tool: 'shell',
				args: {command: 'rm -rf /'},
				output: [{stream: 'stderr', text: 'User denied execution'}],
				status: 'failed',
				fields: {}
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /⊘ \$ rm -rf \//);
	assert.match(frame, /已拒绝/);
	assert.doesNotMatch(frame, /DENIED/);
	app.unmount();
});

test('Ink snapshot: live region collapses to a paused notice while an approval is pending', () => {
	let runningToolState = reducer(readyState(), {type: 'submit_user', text: '部署前端', clientMessageId: 'client_1'});
	runningToolState = reducer(runningToolState, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	runningToolState = reducer(runningToolState, {
		type: 'engine_event',
		event: {type: 'tool_started', turnId: 'turn_1', id: 't1', tool: 'shell', args: {command: 'sleep 99'}}
	});

	const paused = reducer(runningToolState, {
		type: 'engine_event',
		event: {type: 'approval_requested', runId: 'turn_1', turnId: 'turn_1', id: 'a1', tool: 'shell', description: 'run', risk: 'Shell', context: 'sleep 99'}
	});
	const app = renderWithProviders(<MainContent state={paused} staticEpoch={0} onStaticDrift={noopDrift} />, {state: paused});
	const frame = plainFrame(app.lastFrame());
	assert.match(frame, /运行已暂停，等待审批/, 'paused notice replaces the live spinners');
	assert.doesNotMatch(frame, /sleep 99/, 'running tool preview hidden while the dialog is up');
	app.unmount();

	// Control: without the approval the running preview renders as usual.
	const control = renderWithProviders(<MainContent state={runningToolState} staticEpoch={0} onStaticDrift={noopDrift} />, {state: runningToolState});
	const controlFrame = plainFrame(control.lastFrame());
	assert.match(controlFrame, /sleep 99/);
	assert.doesNotMatch(controlFrame, /运行已暂停/);
	control.unmount();
});

test('Ink snapshot: glob row shows pattern, count header and an elbow-indented match list', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			tools={[{
				id: 'glob_1',
				tool: 'glob',
				args: {pattern: '**/*.tsx', path: '.'},
				output: [{stream: 'stdout', text: 'src/App.tsx\nsrc/pages/Login.tsx\nsrc/pages/Register.tsx\nsrc/components/Card.tsx\nsrc/components/Badge.tsx'}],
				status: 'success',
				fields: {}
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /glob \*\*\/\*\.tsx → 共 5 个文件/, 'pattern + count header, not the useless path arg');
	assert.doesNotMatch(frame, /glob \. /, 'path "." no longer masquerades as the query');
	// Collapsed body lists the first 3 matches (elbow on the first) + fold hint.
	assert.match(frame, /⎿ src\/App\.tsx/);
	assert.match(frame, /src\/pages\/Login\.tsx/);
	assert.match(frame, /src\/pages\/Register\.tsx/);
	assert.doesNotMatch(frame, /src\/components\/Card\.tsx/, 'beyond the limit folds');
	assert.match(frame, /… \+2 个文件 \(Ctrl\+O 展开\)/);
	app.unmount();
});

test('Ink snapshot: expanded glob lists every match', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			expanded
			tools={[{
				id: 'glob_2',
				tool: 'glob',
				args: {pattern: '**/*.tsx'},
				output: [{stream: 'stdout', text: 'src/App.tsx\nsrc/pages/Login.tsx\nsrc/pages/Register.tsx\nsrc/components/Card.tsx\nsrc/components/Badge.tsx'}],
				status: 'success',
				fields: {},
				expanded: true
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /src\/components\/Card\.tsx/);
	assert.match(frame, /src\/components\/Badge\.tsx/);
	assert.doesNotMatch(frame, /个文件 \(Ctrl\+O 展开\)/, 'no fold hint when fully expanded');
	app.unmount();
});

test('Ink snapshot: read_file renders empty files without phantom lines', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			expanded
			tools={[{
				id: 'read_1',
				tool: 'read_file',
				args: {input: 'styles.css'},
				output: [{stream: 'stdout', text: ''}],
				status: 'success',
				fields: {}
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /read_file styles\.css → 空文件/);
	assert.doesNotMatch(frame, /1 行/);
	assert.doesNotMatch(frame, /\d+\s+│/);
	app.unmount();
});

test('Ink snapshot: inspection tools collapse into a summary', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			tools={[
				{
					id: 'list_1',
					tool: 'list_dir',
					args: {path: '.'},
					output: [{stream: 'stdout', text: 'src\npackage.json'}],
					status: 'success',
					fields: {}
				},
				{
					id: 'read_1',
					tool: 'read_file',
					args: {path: 'package.json'},
					output: [{stream: 'stdout', text: '{\n  "name": "demo"\n}'}],
					status: 'success',
					fields: {}
				},
				{
					id: 'read_2',
					tool: 'read_file',
					args: {path: 'src/App.tsx'},
					output: [{stream: 'stdout', text: 'export function App() {}'}],
					status: 'success',
					fields: {}
				}
			]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /读取 2 个文件: package\.json, App\.tsx · 列目录 1 次 \(Ctrl\+O 展开\)/);
	assert.doesNotMatch(frame, /read_file package\.json/);
	assert.doesNotMatch(frame, /tools \(3\)/);
	app.unmount();
});

test('Ink snapshot: many successful shell tools collapse into activity summary', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			tools={[
				{id: 's1', tool: 'shell', args: {command: 'npm run dev'}, output: [{stream: 'stderr', text: 'missing vite'}], status: 'success', fields: {exit: '0'}},
				{id: 's2', tool: 'shell', args: {command: 'npm install'}, output: [{stream: 'stdout', text: 'installed'}], status: 'success', fields: {exit: '0'}},
				{id: 's3', tool: 'shell', args: {command: 'npm test'}, output: [{stream: 'stdout', text: 'ok'}], status: 'success', fields: {exit: '0'}},
				{id: 's4', tool: 'shell', args: {command: 'npm run build'}, output: [{stream: 'stdout', text: 'built'}], status: 'success', fields: {exit: '0'}}
			]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /工具: 4 完成 · shell ×4 \(Ctrl\+O 展开\)/);
	assert.doesNotMatch(frame, /\$ npm install/);
	assert.doesNotMatch(frame, /installed/);
	app.unmount();
});

test('Ink snapshot: activity summary includes the batch total duration', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			tools={[
				{id: 'd1', tool: 'shell', args: {command: 'uptime'}, output: [{stream: 'stdout', text: 'up'}], status: 'success', fields: {exit: '0', duration: '64ms'}},
				{id: 'd2', tool: 'shell', args: {command: 'vm_stat'}, output: [{stream: 'stdout', text: 'pages'}], status: 'success', fields: {exit: '0', duration: '29ms'}},
				{id: 'd3', tool: 'shell', args: {command: 'df -h'}, output: [{stream: 'stdout', text: 'disk'}], status: 'success', fields: {exit: '0', duration: '31ms'}},
				{id: 'd4', tool: 'shell', args: {command: 'sysctl hw'}, output: [{stream: 'stdout', text: 'hw'}], status: 'success', fields: {exit: '0', duration: '1.2s'}}
			]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	// 64+29+31+1200 = 1324ms → 1.3s
	assert.match(frame, /工具: 4 完成 · shell ×4 · 共 1\.3s/);
	app.unmount();
});

test('Ink snapshot: table-like shell output keeps left columns (tail truncation)', () => {
	const wideRow = 'Filesystem      Size  Used  Avail Capacity iused ifree %iused Mounted-on-' + 'x'.repeat(120);
	const app = renderWithProviders(
		<ToolGroupMessage
			expanded
			tools={[{
				id: 'df1',
				tool: 'shell',
				args: {command: 'df -h /'},
				output: [{stream: 'stdout', text: wideRow}],
				status: 'success',
				fields: {exit: '0'}
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	// Left columns survive; no middle-ellipsis splice through the table.
	assert.match(frame, /Filesystem\s+Size\s+Used/);
	assert.doesNotMatch(frame, /Filesystem[^\n]*…[^\n]*x{5,}/);
	app.unmount();
});

test('Ink snapshot: compact thinking collapses finished thoughts to one line', () => {
	const state = readyState({
		transcript: {
			...initialState.transcript,
			entries: [{
				id: 'entry_1',
				role: 'assistant',
				text: '',
				status: 'streaming',
				turnId: 'turn_1',
				segments: [
					{kind: 'thinking', id: 't1', text: 'checking package manager'},
					{kind: 'thinking', id: 't2', text: 'installing missing dependencies'}
				]
			}]
		}
	});
	const app = renderWithProviders(
		<MainContent state={state} staticEpoch={0} onStaticDrift={noopDrift} />,
		{state}
	);
	const frame = plainFrame(app.lastFrame());

	// Finished thinking settles as a collapsed one-liner; the live one spins.
	assert.match(frame, /▸ Thought · checking package manager/);
	assert.match(frame, /Thinking/);
	app.unmount();
});

test('Ink snapshot: write_file renders a code diff preview', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			tools={[{
				id: 'write_1',
				tool: 'write_file',
				args: {path: 'dashboard/src/App.jsx'},
				output: [{
					stream: 'stdout',
					text: [
						'Added 2 lines, removed 1 lines',
						'--- dashboard/src/App.jsx',
						'+++ dashboard/src/App.jsx',
						'@@ -1,1 +1,2 @@',
						'-const oldValue = 1;',
						'+const newValue = 2;',
						'+export default newValue;'
					].join('\n')
				}],
				status: 'success',
				fields: {}
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /Write dashboard\/src\/App\.jsx \(\+2 -1\)/);
	assert.match(frame, /- const oldValue = 1/);
	assert.match(frame, /\+ const newValue = 2/);
	app.unmount();
});

test('Ink snapshot: successful edit_file compact preview shows +/- not only leading context', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			tools={[{
				id: 'edit_1',
				tool: 'edit_file',
				args: {path: 'cli/src/test/scala/EscCancelSpec.scala'},
				output: [{
					stream: 'stdout',
					text: [
						'Edited cli/src/test/scala/EscCancelSpec.scala',
						'--- a/cli/src/test/scala/EscCancelSpec.scala',
						'+++ b/cli/src/test/scala/EscCancelSpec.scala',
						'@@ -123,11 +123,11 @@',
						' waitForEvent("ready") shouldBe defined',
						' ',
						' // 2. Send StartSession -> wait for session_ready',
						' val sessionId = waitForEvent("session_ready").get.payload',
						'-oldAssertion()',
						'+newAssertion()',
						' // trailing a',
						' // trailing b',
						' // trailing c',
						' // trailing d',
						' // trailing e'
					].join('\n')
				}],
				status: 'success',
				fields: {}
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /Edit .*EscCancelSpec\.scala \(\+1 -1\)/);
	assert.match(frame, /- oldAssertion/);
	assert.match(frame, /\+ newAssertion/);
	assert.doesNotMatch(frame, /waitForEvent\("ready"\) shouldBe defined/);
	app.unmount();
});

test('Ink snapshot: ApprovalDialog uses selectable choices', () => {
	const app = renderWithProviders(
		<ApprovalDialog
			approval={{
				id: 'approval_1',
				tool: 'shell',
				description: 'Run command',
				risk: 'Shell',
				context: 'npm install'
			}}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /Bash command/);
	assert.match(frame, /Command/);
	assert.match(frame, /npm install/);
	assert.match(frame, /install packages or access the network/);
	assert.match(frame, /❯ 1\. Yes/);
	assert.match(frame, /2\. Yes, always for this session/);
	assert.match(frame, /Esc to cancel/);
	// Vertical economy: the compacted dialog must stay within the rows the
	// live region reserves for it (border to border, margin included).
	const rows = (app.lastFrame() ?? '').split('\n').length;
	assert.ok(rows <= 16, `approval dialog grew to ${rows} rows (reserve is 16)`);
	app.unmount();
});

test('Ink snapshot: QuestionDialog shows options and custom affordances', () => {
	const app = renderWithProviders(
		<QuestionDialog
			question={{
				id: 'question_1',
				title: 'Project location',
				question: 'Where should the app be created?',
				options: [{id: 'current', label: 'Current repository', recommended: true}],
				allowCustom: true,
				allowChat: false
			}}
			onAnswer={() => undefined}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /Project location/);
	assert.match(frame, /Where should the app be created\?/);
	assert.match(frame, /❯ 1\. Current repository/);
	assert.match(frame, /2\. Type something/);
	assert.doesNotMatch(frame, /Chat about this/);
	app.unmount();
});

test('Ink snapshot: QuestionDialog without options shows composer fallback hint', () => {
	const app = renderWithProviders(
		<QuestionDialog
			question={{
				id: 'question_2',
				title: 'Need input',
				question: 'Please provide a value',
				options: [],
				allowCustom: false,
				allowChat: false
			}}
			onAnswer={() => undefined}
		/>
	);
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /Need input/);
	assert.match(frame, /No predefined options\. Type your answer in composer\./);
	assert.match(frame, /custom text in composer • Enter submit/);
	assert.doesNotMatch(frame, /↑↓ or number/);
	app.unmount();
});

test('Ink snapshot: Footer is a single low-noise status line', () => {
	const state = readyState({
		cwd: '/w',
		queue: [{id: 'q1', text: 'next message', state: 'queued'}],
		tokensUsed: 128
	});
	const app = renderWithProviders(<Footer state={state} />, {state});
	const frame = plainFrame(app.lastFrame());

	assert.match(frame, /default -> deepseek-reasoner/);
	assert.match(frame, /queue:1/);
	assert.match(frame, /128tk/);
	// Single line: no border art, no blank filler rows.
	assert.equal(frame.split('\n').length, 1);
	app.unmount();
});

test('Ink snapshot: Composer renders inline placeholder inside a constant-height bordered box', () => {
	const state = readyState();
	const app = renderWithProviders(
		<Composer ready mode="normal" onClearQueue={() => undefined} onSubmit={() => undefined} />,
		{state}
	);
	const frame = plainFrame(app.lastFrame());

	// Placeholder sits on the SAME row as the prompt (claude-code/gemini-cli
	// style) so empty vs typing states have identical height — no layout jump.
	assert.match(frame, /> 输入消息，或 \/help 查看命令/);
	assert.doesNotMatch(frame, /输入消息，或 \/help 查看命令\s*\n.*>/);
	// Rounded border box: exactly 3 rows (top border, input, bottom border).
	assert.match(frame, /╭/);
	assert.match(frame, /╰/);
	assert.equal(frame.split('\n').length, 3);
	app.unmount();
});

test('Ink snapshot: HelpDialog groups ui-only and engine commands', () => {
	const app = renderWithProviders(
		<HelpDialog commands={[]} />
	);
	const frame = plainFrame(app.lastFrame());
	assert.match(frame, /UI-only/);
	assert.match(frame, /Engine/);
	assert.match(frame, /\/help/);
	assert.match(frame, /\/model/);
	app.unmount();
});

test('Ink snapshot: ThemeDialog shows selectable themes', () => {
	const app = renderWithProviders(<ThemeDialog selected={0} currentTheme="default-dark" />);
	const frame = plainFrame(app.lastFrame());
	assert.match(frame, /❯ default-dark/);
	assert.match(frame, /\(current\)/);
	// Full built-in palette is listed with color swatches.
	for (const name of ['default-light', 'dracula', 'gruvbox-dark', 'nord', 'solarized-light', 'ansi', 'no-color']) {
		assert.match(frame, new RegExp(name));
	}
	assert.match(frame, /●/);
	app.unmount();
});

test('Ink snapshot: FooterConfigDialog shows toggles', () => {
	const app = renderWithProviders(
		<FooterConfigDialog selected={0} config={defaultFooterConfig} />
	);
	const frame = plainFrame(app.lastFrame());
	assert.match(frame, /\[x\] Model name/);
	assert.match(frame, /Enter toggles item/);
	app.unmount();
});

test('Ink snapshot: ToolGroupMessage renders timeline summary', () => {
	const app = renderWithProviders(
		<ToolGroupMessage
			tools={[{
				id: 'dense_1',
				tool: 'read_file',
				args: {path: 'src/App.tsx'},
				output: [{stream: 'stdout', text: 'ok'}],
				status: 'success',
				fields: {}
			}]}
		/>
	);
	const frame = plainFrame(app.lastFrame());
	assert.match(frame, /读取 1 个文件: App\.tsx \(Ctrl\+O 展开\)/);
	assert.doesNotMatch(frame, /read src\/App.tsx/);
	app.unmount();
});

test('Ink snapshot: Footer shows running marker when busy', () => {
	const state = readyState({running: true, tokensUsed: 64});
	const app = renderWithProviders(<Footer state={state} />, {state});
	const frame = plainFrame(app.lastFrame());
	assert.match(frame, /running/);
	assert.match(frame, /●/);
	app.unmount();
});

test('Ink snapshot: Footer warns when the engine stops responding', () => {
	const stale = readyState({lastEngineEventAt: Date.now() - 8_000});
	const app = renderWithProviders(<Footer state={stale} />, {state: stale});
	assert.match(plainFrame(app.lastFrame()), /引擎无响应 [78]s/);
	app.unmount();

	const fresh = readyState({lastEngineEventAt: Date.now()});
	const healthy = renderWithProviders(<Footer state={fresh} />, {state: fresh});
	assert.doesNotMatch(plainFrame(healthy.lastFrame()), /引擎无响应/);
	healthy.unmount();
});

for (const rows of [8, 24, 60] as const) {
	test(`Ink snapshot: Transcript chrome at ${rows} terminal rows`, () => {
		const previousRows = process.stdout.rows;
		Object.defineProperty(process.stdout, 'rows', {value: rows, configurable: true});
		const state = readyState({
			transcript: {
				...initialState.transcript,
				entries: [
					{id: 'u1', role: 'user', text: 'hello', status: 'done', turnId: 't1'},
					{id: 'a1', role: 'assistant', text: 'world', status: 'done', turnId: 't1'}
				]
			}
		});
		const app = renderWithProviders(
			<MainContent state={state} />,
			{state}
		);
		const frame = plainFrame(app.lastFrame());
		assert.match(frame, /hello|world|fast-ink|输入消息/);
		assert.ok(frame.split('\n').length >= 1);
		app.unmount();
		Object.defineProperty(process.stdout, 'rows', {value: previousRows, configurable: true});
	});
}
