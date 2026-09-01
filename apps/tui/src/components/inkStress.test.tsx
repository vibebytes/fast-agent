import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import React from 'react';
import {Box} from 'ink';
import {render} from 'ink-testing-library';
import {ToolGroupMessage} from './tools/ToolGroupMessage.js';
import {AppHeader} from './AppHeader.js';
import {MainContent} from './MainContent.js';
import {Footer} from './Footer.js';
import {ThemeProvider} from '../contexts/ThemeContext.js';
import {initialState, type ToolRun, type UiState} from '../state/model.js';
import {getTerminalStringWidth} from '../theme/semanticTheme.js';
import {stripAnsi} from '../utils/textWidth.js';
import {getFlickerFrameCount, getLastFlickerInfo, resetFlickerFrameCount} from '../hooks/useFlickerDetector.js';

function wrap(element: React.ReactElement) {
	return (
		<ThemeProvider themeName="no-color" setThemeName={() => undefined}>
			{element}
		</ThemeProvider>
	);
}

function buildStressTool(index: number): ToolRun {
	const longTail = `LONG-${index}-` + 'x'.repeat(220) + `-ENDLONG-${index}`;
	const shortTail = `SHORT-${index}`;
	const mixedPayload = index % 2 === 0
		? `${longTail} 中文宽字符压力测试`
		: `${shortTail} 中英mix`;

	return {
		id: 'shell_stress',
		tool: 'shell',
		args: {command: `echo frame-${index}`},
		output: [{stream: 'stdout', text: `frame-${index} ${mixedPayload}`}],
		status: 'success',
		fields: {exit: '0'}
	};
}

function buildNoisyAlternatingTool(index: number): ToolRun {
	const longOut = `NOISE-LONG-OUT-${index}-` + 'o'.repeat(180) + `-ENDOUT-${index}`;
	const longErr = `NOISE-LONG-ERR-${index}-` + 'e'.repeat(160) + `-ENDERR-${index}`;
	const stdoutPayload = index % 2 === 0 ? longOut : `NOISE-SHORT-OUT-${index}`;
	const stderrPayload = index % 2 === 0 ? `NOISE-SHORT-ERR-${index}` : longErr;

	return {
		id: 'shell_noise',
		tool: 'shell',
		args: {command: `bash noisy-${index}.sh`},
		output: [
			{stream: 'stdout', text: `OUT-MARK-${index} ${stdoutPayload}\rprogress-${index}\nstdout-tail-${index}`},
			{stream: 'stderr', text: `ERR-MARK-${index} ${stderrPayload}\nstderr-tail-${index}`}
		],
		status: 'success',
		fields: {exit: '0'}
	};
}

function buildCollapsedLinesTool(lineCount: number): ToolRun {
	const lines = Array.from({length: lineCount}, (_, i) => `line-${i + 1}`).join('\n');
	return {
		id: 'shell_collapsed',
		tool: 'shell',
		args: {command: 'printf stress'},
		output: [{stream: 'stdout', text: lines}],
		status: 'success',
		fields: {exit: '0'}
	};
}

function buildNarrowCjkTool(index: number): ToolRun {
	const longSignature = `NARROW-CJK-LONG-${index}-` + '超窄终端宽字符'.repeat(24) + `-ENDN-${index}`;
	const shortSignature = `NARROW-CJK-SHORT-${index}`;
	const stdoutPayload = index % 2 === 0 ? longSignature : shortSignature;
	const stderrPayload = index % 3 === 0
		? `ERR-CJK-${index}-` + '错误信息'.repeat(14)
		: `ERR-CJK-${index}`;

	return {
		id: 'shell_narrow_cjk',
		tool: 'shell',
		args: {command: `echo narrow-cjk-${index}`},
		output: [
			{stream: 'stdout', text: `NARROW-MARK-${index} ${stdoutPayload}\nstdout-${index}`},
			{stream: 'stderr', text: `${stderrPayload}\nstderr-${index}`}
		],
		status: 'success',
		fields: {exit: '0'}
	};
}

function createRng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertFrameWithinWidth(frame: string, width: number): void {
	for (const line of frame.split('\n')) {
		assert.ok(
			getTerminalStringWidth(line) <= width,
			`line exceeded ${width} columns: ${line}`
		);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFreshFrame(app: {lastFrame(): string | undefined}, pattern: RegExp): Promise<string> {
	let raw = app.lastFrame() ?? '';
	for (let attempt = 0; attempt < 200 && !pattern.test(stripAnsi(raw)); attempt += 1) {
		await sleep(5);
		raw = app.lastFrame() ?? '';
	}
	return raw;
}

function withStdoutProps<T>(patch: Partial<Record<'columns' | 'rows', number>>, run: () => T): T {
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries(patch)) {
		previous.set(key, Object.getOwnPropertyDescriptor(process.stdout, key));
		Object.defineProperty(process.stdout, key, {
			value,
			configurable: true,
			enumerable: true,
			writable: true
		});
	}
	try {
		return run();
	} finally {
		for (const [key, descriptor] of previous.entries()) {
			if (descriptor) {
				Object.defineProperty(process.stdout, key, descriptor);
			} else {
				delete (process.stdout as unknown as Record<string, unknown>)[key];
			}
		}
	}
}

function buildRandomNoiseTool(index: number, rng: () => number): {tool: ToolRun; longSignatures: string[]} {
	const useLongOut = rng() > 0.45;
	const useLongErr = rng() > 0.55;
	const outLongLength = 120 + Math.floor(rng() * 260);
	const errLongLength = 100 + Math.floor(rng() * 220);
	const outLongSignature = `SOAK-OUT-LONG-${index}-${Math.floor(rng() * 1000)}`;
	const errLongSignature = `SOAK-ERR-LONG-${index}-${Math.floor(rng() * 1000)}`;
	const outPayload = useLongOut
		? `${outLongSignature}-${'o'.repeat(outLongLength)}`
		: `SOAK-OUT-SHORT-${index}`;
	const errPayload = useLongErr
		? `${errLongSignature}-${'e'.repeat(errLongLength)}`
		: `SOAK-ERR-SHORT-${index}`;
	const includeCarriage = rng() > 0.5;

	return {
		tool: {
			id: 'shell_soak',
			tool: 'shell',
			args: {command: `bash soak-${index}.sh`},
			output: [
				{
					stream: 'stdout',
					text: includeCarriage
						? `SOAK-OUT-${index} ${outPayload}\rprogress-${index}\nstdout-tail-${index}`
						: `SOAK-OUT-${index} ${outPayload}\nstdout-tail-${index}`
				},
				{
					stream: 'stderr',
					text: `SOAK-ERR-${index} ${errPayload}\nstderr-tail-${index}`
				}
			],
			status: 'success',
			fields: {exit: '0'}
		},
		longSignatures: [useLongOut ? outLongSignature : '', useLongErr ? errLongSignature : ''].filter(Boolean)
	};
}

function buildComplexCharactersTool(index: number): {tool: ToolRun; previousSignature: string} {
	const signature = `COMPLEX-LONG-SIGNATURE-${index}`;
	const longUrl = `https://example.com/${'very-long-path/'.repeat(12)}token-${index}-${signature}`;
	const ansi = `\u001b[31mRED-${index}\u001b[0m`;
	const fullWidth = `全角标点：，。；！（）【】`;
	const mixed = `混合English🚀emoji🙂宽字符￥￥`;
	const withBackspace = `typing-${index}\b\b\bEND-${index}`;

	return {
		tool: {
			id: 'shell_complex_chars',
			tool: 'shell',
			args: {command: `bash complex-${index}.sh`},
			output: [
				{
					stream: 'stdout',
					text: [
						`COMPLEX-MARK-${index} ${longUrl}`,
						`progress 10%\rprogress 90% done-${index}`,
						`${ansi} ${mixed} ${fullWidth}`,
						withBackspace
					].join('\n')
				},
				{
					stream: 'stderr',
					text: `COMPLEX-ERR-${index} ${fullWidth} ${mixed}`
				}
			],
			status: 'success',
			fields: {exit: '0'}
		},
		previousSignature: signature
	};
}

function readyState(patch: Partial<UiState> = {}): UiState {
	return {
		...initialState,
		ready: true,
		running: false,
		inputMode: 'normal',
		status: 'ready',
		model: 'default',
		modelDisplay: 'default -> deepseek-reasoner',
		cwd: '/tmp/workspace',
		...patch
	};
}

// NOTE: the streaming turn stays ACTIVE so its text lives in the live
// (re-rendered) region. Settled content is append-only by design — mutating
// it in place is exactly the corruption the new <Static> architecture forbids.
function buildLayoutState(index: number): UiState {
	const longTail = `LAYOUT-LONG-${index}-` + 'y'.repeat(200) + `-MARK-${index}`;
	const shortTail = `LAYOUT-SHORT-${index}`;
	const payload = index % 2 === 0 ? `${longTail} 宽字符` : `${shortTail} mixed`;
	const assistantText = `assistant-frame-${index} ${payload}`;

	return readyState({
		running: true,
		inputMode: 'running',
		tokensUsed: index,
		queue: [{id: `q-${index}`, text: `queued-${index}`, state: 'queued'}],
		transcript: {
			...initialState.transcript,
			entries: [
				{id: 'entry_user_stress', role: 'user', text: 'user-stress', status: 'done', turnId: 'turn_stress'},
				{
					id: 'entry_stress',
					role: 'assistant',
					text: '',
					status: 'streaming',
					turnId: 'turn_stress',
					segments: [{kind: 'assistant', id: 'seg-a', text: assistantText}]
				}
			]
		}
	});
}

function buildNarrowLayoutState(index: number): UiState {
	const signature = index % 2 === 0
		? `NARROW-LAYOUT-LONG-${index}-` + '终端窄宽度布局'.repeat(18)
		: `NARROW-LAYOUT-SHORT-${index}`;
	const assistantText = `NARROW-LAYOUT-MARK-${index} ${signature}`;

	return readyState({
		running: true,
		inputMode: 'running',
		cwd: '/tmp/窄终端-路径',
		tokensUsed: index,
		queue: [{id: `nq-${index}`, text: `narrow-queue-${index}`, state: 'queued'}],
		transcript: {
			...initialState.transcript,
			entries: [
				{id: 'entry_narrow_user', role: 'user', text: 'narrow-user', status: 'done', turnId: 'turn_narrow_stress'},
				{
					id: 'entry_narrow_stress',
					role: 'assistant',
					text: '',
					status: 'streaming',
					turnId: 'turn_narrow_stress',
					segments: [{kind: 'assistant', id: 'seg-n', text: assistantText}]
				}
			]
		}
	});
}

function buildAnimatedMixedState(index: number): UiState {
	const longOutputSignature = `ANIM-OUT-LONG-${index}`;
	const outputText = index % 2 === 0
		? `ANIM-OUT-SHORT-${index}\nline-${index}`
		: `${longOutputSignature}-` + 'z'.repeat(180) + `\nline-${index}`;
	const toolStatus: ToolRun['status'] = index % 2 === 0 ? 'running' : 'success';

	return readyState({
		running: true,
		inputMode: 'running',
		status: 'running',
		toolsExpanded: true,
		transcript: {
			...initialState.transcript,
			entries: [
				{id: 'entry_anim_user', role: 'user', text: 'anim-user', status: 'done', turnId: 'turn_anim_mix'},
				{
					id: 'entry_anim_mix',
					role: 'assistant',
					text: '',
					status: 'streaming',
					turnId: 'turn_anim_mix',
					tools: [{
						id: 'tool_anim_mix',
						tool: 'shell',
						args: {command: `bash anim-${index}.sh`},
						output: `${outputText}\nanim-err-${index}`,
						status: toolStatus,
						fields: {exit: toolStatus === 'success' ? '0' : ''}
					}],
					segments: [
						{
							kind: 'thinking',
							id: 'thinking-anim',
							text: `ANIM-THINK ${'思考'.repeat(index % 3 === 0 ? 30 : 5)}`
						},
						{kind: 'tools', id: 'tools-anim', toolIds: ['tool_anim_mix']}
					]
				}
			]
		}
	});
}

test('Ink stress: tool stream high-frequency rerender without stale long-tail artifacts', () => {
	const app = render(
		wrap(<ToolGroupMessage expanded tools={[buildStressTool(0)]} />)
	);

	for (let index = 1; index <= 120; index += 1) {
		app.rerender(wrap(<ToolGroupMessage expanded tools={[buildStressTool(index)]} />));
		const raw = app.lastFrame() ?? '';
		const marker = `frame-${index}`;
		assert.match(raw, new RegExp(marker));
		assert.doesNotMatch(raw, /\u001b\[\?2026[hl]/);
		assert.doesNotMatch(raw, /\u001b\[K/);
		if (index % 2 === 1) {
			assert.doesNotMatch(raw, new RegExp(`ENDLONG-${index - 1}`));
		}
	}

	app.unmount();
});

test('Ink stress: full layout high-frequency rerender keeps latest frame only', () => {
	let state = buildLayoutState(0);
	const app = render(
		wrap(
			<Box flexDirection="column" width={80}>
				<AppHeader />
				<MainContent state={state} staticEpoch={0} onStaticDrift={() => undefined} />
				<Footer state={state} />
			</Box>
		)
	);

	for (let index = 1; index <= 40; index += 1) {
		state = buildLayoutState(index);
		app.rerender(
			wrap(
				<Box flexDirection="column" width={80}>
					<AppHeader />
					<MainContent state={state} staticEpoch={0} onStaticDrift={() => undefined} />
					<Footer state={state} />
				</Box>
			)
		);
		const raw = app.lastFrame() ?? '';
		assert.match(raw, new RegExp(`assistant-frame-${index}`));
		assert.match(raw, new RegExp(`queued-${index}`));
		assert.doesNotMatch(raw, /\u001b\[\?2026[hl]/);
		assert.doesNotMatch(raw, /\u001b\[K/);
		if (index % 2 === 1) {
			assert.doesNotMatch(raw, new RegExp(`MARK-${index - 1}`));
		}
	}

	app.unmount();
});

test('Ink stress: subprocess-like stdout/stderr noisy alternation keeps latest markers only', () => {
	const app = render(
		wrap(<ToolGroupMessage expanded tools={[buildNoisyAlternatingTool(0)]} />)
	);

	for (let index = 1; index <= 70; index += 1) {
		const tool = buildNoisyAlternatingTool(index);
		app.rerender(wrap(<ToolGroupMessage expanded tools={[tool]} />));
		const raw = app.lastFrame() ?? '';
		const stdoutHasCarriage = tool.output[0]?.text.includes('\r') ?? false;
		assert.match(raw, stdoutHasCarriage ? new RegExp(`progress-${index}`) : new RegExp(`OUT-MARK-${index}`));
		assert.match(raw, new RegExp(`ERR-MARK-${index}`));
		assert.doesNotMatch(raw, /\u001b\[\?2026[hl]/);
		assert.doesNotMatch(raw, /\u001b\[K/);
		if (index % 2 === 1) {
			assert.doesNotMatch(raw, new RegExp(`ENDOUT-${index - 1}`));
		} else {
			assert.doesNotMatch(raw, new RegExp(`ENDERR-${index - 1}`));
		}
	}

	app.unmount();
});

test('Ink stress: collapsed hidden-line hint shrinks without stale suffix residue', () => {
	const app = render(
		wrap(<ToolGroupMessage tools={[buildCollapsedLinesTool(60)]} />)
	);

	const longFrame = app.lastFrame() ?? '';
	assert.match(longFrame, /\+\d+ 行/);

	app.rerender(wrap(<ToolGroupMessage tools={[buildCollapsedLinesTool(2)]} />));
	const shortFrame = app.lastFrame() ?? '';
	assert.doesNotMatch(shortFrame, /\+\d+ 行/);
	assert.doesNotMatch(shortFrame, /line-60/);
	assert.doesNotMatch(shortFrame, /\u001b\[\?2026[hl]/);
	assert.doesNotMatch(shortFrame, /\u001b\[K/);

	app.unmount();
});

test('Ink stress: Ctrl+O hidden-line hints stay isolated from following Maven output', () => {
	const buildMavenTool = (index: number, lineCount: number): ToolRun => ({
		id: 'shell_maven_overlap',
		tool: 'shell',
		args: {
			command: `${join(homedir(), 'Downloads', 'agenttes…ard', `DashboardApplication.java-${index}`)} || echo 'gradle not installed'`
		},
		output: [{
			stream: 'stdout',
			text: [
				`maven-start-${index}`,
				`[FATAL] Non-readable settings ${join(homedir(), '.m2', 'settings.xml')}: input contained no data @ ${join(homedir(), '.m2', 'settings.xml')}`,
				...Array.from({length: lineCount}, (_, i) =>
					i === lineCount - 1
						? `were encountered while processing the POMs:rter-parent/3.3.5/spring-boot-starter-parent-3.3.5.pom-${index}`
						: `maven-hidden-${index}-${i}-` + 'x'.repeat(80)
				)
			].join('\n')
		}],
		status: 'success',
		fields: {exit: '1'}
	});

	withStdoutProps({columns: 80, rows: 24}, () => {
		const app = render(wrap(
			<Box width={80}>
				<ToolGroupMessage tools={[buildMavenTool(0, 16)]} />
			</Box>
		));

		app.rerender(wrap(
			<Box width={80}>
				<ToolGroupMessage tools={[buildMavenTool(1, 14)]} />
			</Box>
		));

		const frame = app.lastFrame() ?? '';
		assert.match(frame, /\+\d+ 行/);
		const plain = stripAnsi(frame);
		const hintLines = plain.split('\n').filter(line => /\+\d+ 行/.test(line));
		assert.ok(hintLines.length > 0);
		for (const line of hintLines) {
			assert.match(line, /\(Ctrl\+O 展开\)/);
			assert.doesNotMatch(line, /were encountered|maven-hidden|maven-start/);
		}
		assertFrameWithinWidth(frame, 80);
		app.unmount();
	});
});

test('Ink stress: multi-item live region (thinking+tools+stream) never exceeds the viewport', () => {
	// Regression for the torn-frame screenshot: a running turn with a long
	// thinking block, a running tool group AND a streaming assistant tail.
	// With a per-item budget the combined live region outgrew 24 rows and
	// Ink left ghost "Thinking" lines behind on every repaint.
	resetFlickerFrameCount();
	const thinkingText = Array.from({length: 30}, (_, i) => `思考过程第${i}行,分析CPU占用`).join('\n');
	const streamTail = Array.from({length: 40}, (_, i) => `流式输出行-${i}`).join('\n');
	const state = readyState({
		running: true,
		inputMode: 'running',
		transcript: {
			...initialState.transcript,
			entries: [
				{id: 'entry_user_live', role: 'user', text: '查看系统当前最消耗CPU的进程', status: 'done', turnId: 'turn_live'},
				{
					id: 'entry_live',
					role: 'assistant',
					text: '',
					status: 'streaming',
					turnId: 'turn_live',
					tools: [{
						id: 'shell_live',
						tool: 'shell',
						args: {command: 'top -l 1 -o cpu'},
						output: Array.from({length: 20}, (_, i) => `proc-${i}`).join('\n'),
						status: 'running',
						fields: {}
					}],
					segments: [
						{kind: 'thinking', id: 'seg-t', text: thinkingText},
						{kind: 'tools', id: 'seg-tools', toolIds: ['shell_live']},
						{kind: 'assistant', id: 'seg-a', text: streamTail}
					]
				}
			]
		}
	});

	withStdoutProps({columns: 80, rows: 24}, () => {
		const app = render(wrap(
			<MainContent state={state} staticEpoch={0} onStaticDrift={() => undefined} />
		));
		// Re-render a few frames the way streaming does.
		for (let index = 0; index < 5; index += 1) {
			app.rerender(wrap(
				<MainContent state={state} staticEpoch={0} onStaticDrift={() => undefined} />
			));
		}
		assert.equal(getFlickerFrameCount(), 0, getLastFlickerInfo());
		app.unmount();
	});
});

test('Ink stress: randomized stdout/stderr jitter soak 400 rounds has no stale residue', () => {
	const rng = createRng(20260610);
	const first = buildRandomNoiseTool(0, rng);
	const app = render(
		wrap(<ToolGroupMessage expanded tools={[first.tool]} />)
	);
	let previousLongSignatures = first.longSignatures;

	for (let index = 1; index <= 400; index += 1) {
		const next = buildRandomNoiseTool(index, rng);
		app.rerender(wrap(<ToolGroupMessage expanded tools={[next.tool]} />));
		const raw = app.lastFrame() ?? '';

		const stdoutHasCarriage = next.tool.output[0]?.text.includes('\r') ?? false;
		assert.match(raw, stdoutHasCarriage ? new RegExp(`progress-${index}`) : new RegExp(`SOAK-OUT-${index}`));
		assert.match(raw, new RegExp(`SOAK-ERR-${index}`));
		assert.doesNotMatch(raw, /\u001b\[\?2026[hl]/);
		assert.doesNotMatch(raw, /\u001b\[K/);

		for (const signature of previousLongSignatures) {
			assert.doesNotMatch(raw, new RegExp(escapeRegExp(signature)));
		}
		previousLongSignatures = next.longSignatures;
	}

	app.unmount();
});

test('Ink stress: ultra-narrow 40-column CJK tool rerender has no stale overlap residue', () => {
	const app = render(
		wrap(
			<Box width={40}>
				<ToolGroupMessage expanded tools={[buildNarrowCjkTool(0)]} />
			</Box>
		)
	);

	for (let index = 1; index <= 180; index += 1) {
		app.rerender(
			wrap(
				<Box width={40}>
					<ToolGroupMessage expanded tools={[buildNarrowCjkTool(index)]} />
				</Box>
			)
		);
		const raw = app.lastFrame() ?? '';
		assert.match(raw, new RegExp(`NARROW-MARK-${index}`));
		assert.doesNotMatch(raw, /\u001b\[\?2026[hl]/);
		assert.doesNotMatch(raw, /\u001b\[K/);
		assert.doesNotMatch(raw, new RegExp(escapeRegExp(`NARROW-MARK-${index - 1}`)));
	}

	app.unmount();
});

test('Ink stress: ultra-narrow 40-column full layout CJK rerender keeps latest frame only', () => {
	let state = buildNarrowLayoutState(0);
	const app = render(
		wrap(
			<Box flexDirection="column" width={40}>
				<AppHeader />
				<MainContent state={state} staticEpoch={0} onStaticDrift={() => undefined} />
				<Footer state={state} />
			</Box>
		)
	);

	for (let index = 1; index <= 60; index += 1) {
		state = buildNarrowLayoutState(index);
		app.rerender(
			wrap(
				<Box flexDirection="column" width={40}>
					<AppHeader />
					<MainContent state={state} staticEpoch={0} onStaticDrift={() => undefined} />
					<Footer state={state} />
				</Box>
			)
		);
		const raw = app.lastFrame() ?? '';
		assert.match(raw, new RegExp(`NARROW-LAYOUT-MARK-${index}`));
		assert.match(raw, new RegExp(`narrow-queue-${index}`));
		assert.doesNotMatch(raw, /\u001b\[\?2026[hl]/);
		assert.doesNotMatch(raw, /\u001b\[K/);
		assert.doesNotMatch(raw, new RegExp(escapeRegExp(`NARROW-LAYOUT-MARK-${index - 1}`)));
	}

	app.unmount();
});

test('Ink stress: animated thinking and tool status switching leaves no stale lines', async () => {
	let state = buildAnimatedMixedState(0);
	const app = render(
		wrap(
			<Box flexDirection="column" width={72}>
				<MainContent state={state} staticEpoch={0} onStaticDrift={() => undefined} />
			</Box>
		)
	);

	let previousLongSignature: string | undefined;
	for (let index = 1; index <= 60; index += 1) {
		state = buildAnimatedMixedState(index);
		app.rerender(
			wrap(
				<Box flexDirection="column" width={72}>
					<MainContent state={state} staticEpoch={0} onStaticDrift={() => undefined} />
				</Box>
			)
		);

		if (index % 15 === 0) {
			await sleep(120);
		}

		const raw = await waitForFreshFrame(app, new RegExp(`bash anim-${index}\\.sh`));
		const plain = stripAnsi(raw);
		assert.match(plain, /anim-user/);
		assert.match(plain, /Thinking/);
		assert.match(plain, new RegExp(`bash anim-${index}\\.sh`));
		assert.doesNotMatch(raw, /\u001b\[\?2026[hl]/);
		assert.doesNotMatch(raw, /\u001b\[K/);

		if (previousLongSignature) {
			assert.doesNotMatch(plain, new RegExp(escapeRegExp(previousLongSignature)));
		}
		previousLongSignature = index % 2 === 1 ? `ANIM-OUT-LONG-${index}` : undefined;
	}

	app.unmount();
});

test('Ink stress: running animation frames rotate without control-sequence injection', async () => {
	const state = buildAnimatedMixedState(0);
	const app = render(
		wrap(
			<Box flexDirection="column" width={72}>
				<MainContent state={state} staticEpoch={0} onStaticDrift={() => undefined} />
			</Box>
		)
	);

	const frames: string[] = [];
	for (let i = 0; i < 4; i += 1) {
		await sleep(190);
		const raw = app.lastFrame() ?? '';
		frames.push(raw);
		assert.match(raw, /Thinking/);
		// Running shell shows a live output tail (stderr is the latest line).
		assert.match(raw, /anim-err-0/);
		assert.doesNotMatch(raw, /\u001b\[\?2026[hl]/);
		assert.doesNotMatch(raw, /\u001b\[K/);
	}

	const distinct = new Set(frames).size;
	assert.ok(distinct > 1, 'expected animated frames to change over time');

	app.unmount();
});

test('Ink stress: terminal dimension matrix rerender keeps latest frame across widths/heights', () => {
	const matrix = [
		{width: 40, height: 12},
		{width: 72, height: 18},
		{width: 120, height: 24},
		{width: 200, height: 42}
	];

	let state = buildLayoutState(0);
	let previousMarker = '';
	const first = matrix[0] ?? {width: 80, height: 24};
	const app = withStdoutProps({columns: first.width, rows: first.height}, () => render(
		wrap(
			<Box flexDirection="column" width={first.width}>
				<AppHeader />
				<MainContent state={state} staticEpoch={0} onStaticDrift={() => undefined} />
				<Footer state={state} />
			</Box>
		)
	));

	for (let index = 1; index <= 80; index += 1) {
		const dims = matrix[index % matrix.length] ?? matrix[0]!;
		state = buildLayoutState(index);
		withStdoutProps({columns: dims.width, rows: dims.height}, () => {
			app.rerender(
				wrap(
					<Box flexDirection="column" width={dims.width}>
						<AppHeader />
						<MainContent state={state} staticEpoch={0} onStaticDrift={() => undefined} />
						<Footer state={state} />
					</Box>
				)
			);
			const raw = app.lastFrame() ?? '';
			// Stick-to-bottom viewport: the head of a long wrapped assistant
			// block may be scrolled out — assert the unique tail marker and
			// the queue row that sit at the bottom of the transcript.
			// Narrow widths may wrap mid-marker (MARK-10 → "MARK-1\\n0"); compare
			// on whitespace-collapsed frames so wrapping does not false-fail.
			const marker = index % 2 === 0 ? `MARK-${index}` : `LAYOUT-SHORT-${index}`;
			const compact = raw.replace(/\s+/g, '');
			assert.ok(compact.includes(marker), `expected ${marker} in frame`);
			assert.ok(compact.includes(`queued-${index}`), `expected queued-${index} in frame`);
			assert.doesNotMatch(raw, /\u001b\[\?2026[hl]/);
			assert.doesNotMatch(raw, /\u001b\[K/);
			if (previousMarker) {
				assert.ok(!compact.includes(previousMarker), `stale marker ${previousMarker} still visible`);
			}
			previousMarker = marker;
		});
	}

	app.unmount();
});

test('Ink stress: complex stream characters keep rendering stable without stale residue', () => {
	const first = buildComplexCharactersTool(0);
	const app = render(
		wrap(
			<Box width={72}>
				<ToolGroupMessage expanded tools={[first.tool]} />
			</Box>
		)
	);

	let previousSignature = first.previousSignature;
	for (let index = 1; index <= 60; index += 1) {
		const next = buildComplexCharactersTool(index);
		app.rerender(
			wrap(
				<Box width={72}>
					<ToolGroupMessage expanded tools={[next.tool]} />
				</Box>
			)
		);

		const raw = app.lastFrame() ?? '';
		assert.match(raw, new RegExp(`COMPLEX-MARK-${index}`));
		assert.match(raw, new RegExp(`COMPLEX-ERR-${index}`));
		assert.doesNotMatch(raw, /\u001b\[\?2026[hl]/);
		assert.doesNotMatch(raw, /\u001b\[K/);
		assert.doesNotMatch(raw, /\r/);
		assert.doesNotMatch(raw, /\u0008/);
		assert.doesNotMatch(raw, new RegExp(escapeRegExp(previousSignature)));
		previousSignature = next.previousSignature;
	}

	app.unmount();
});
