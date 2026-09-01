/**
 * E2E PTY test harness for real Scala engine + deepseek-reasoner LLM.
 *
 * Spawns the full cli-ink TUI in a pseudo-terminal against the real engine
 * (not mock-engine), driving it with node-pty and verifying the rendered
 * output through @xterm/headless.
 *
 * Usage:
 *   const h = await createE2EHarness(t);   // t = node:test context
 *   await h.submit('请运行命令 echo hello');
 *   await h.waitFor(() => h.transcript.includes('Do you want to proceed'), 'approval dialog');
 *   h.write('y');
 *   ...
 *   h.cleanup();
 */
import path from 'node:path';
import {mkdtempSync, mkdirSync, writeFileSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import type {TestContext} from 'node:test';
import * as pty from 'node-pty';

const require = createRequire(import.meta.url);
const {Terminal} = require('@xterm/headless') as {
	Terminal: new (options?: {cols?: number; rows?: number; scrollback?: number; allowProposedApi?: boolean}) => {
		write: (data: string, callback?: () => void) => void;
		buffer: {
			active: {
				baseY: number;
				cursorX: number;
				cursorY: number;
				length: number;
				getLine: (index: number) => {translateToString: (trimRight?: boolean) => string} | undefined;
			};
		};
	};
};

const COLS = 120;
const ROWS = 40;

export function shellToolPrompt(command: string, extra = ''): string {
	return [
		'E2E测试协议：不要用自然语言回答，不要说“命令已执行”。',
		'你的下一步必须发起 Shell 工具调用，并等待用户批准。',
		`Shell 工具的 command 参数必须精确等于：${command}`,
		'批准前不要输出 marker、命令结果或解释。',
		extra,
	].filter(Boolean).join(' ');
}

export function shellToolSequencePrompt(commands: string[], extra = ''): string {
	return [
		'E2E测试协议：不要用自然语言回答，不要说“命令已执行”。',
		'你必须按顺序发起多个独立的 Shell 工具调用，每次调用后等待用户批准。',
		...commands.map((command, index) => `第 ${index + 1} 个 Shell 工具的 command 参数必须精确等于：${command}`),
		'批准前不要输出 marker、命令结果或解释。',
		extra,
	].filter(Boolean).join(' ');
}

export type E2EHarness = {
	waitFor(predicate: () => boolean | Promise<boolean>, what: string, timeoutMs?: number): Promise<void>;
	waitForScreen(pattern: string | RegExp, what: string, timeoutMs?: number): Promise<void>;
	waitForScreenGone(pattern: string | RegExp, what: string, timeoutMs?: number): Promise<void>;
	expectScreenStaysGone(pattern: string | RegExp, what: string, durationMs?: number): Promise<void>;
	waitForIdle(timeoutMs?: number): Promise<void>;
	screenText(): Promise<string>;
	/** Cursor position after replaying the PTY stream into @xterm/headless. */
	cursorPosition(): Promise<{x: number; y: number}>;
	transcript: string;
	write(data: string): void;
	submit(text: string): Promise<void>;
	resize(cols: number, rows: number): void;
	cleanup(): void;
	exitCode(): Promise<number>;
	exited: boolean;
	/** The HOME dir used by this harness (pass to a second harness for session restore). */
	home: string;
};

export type HarnessOptions = {
	/** Override engine command (e.g. for mock-engine tests). */
	engineCommand?: string;
	/** Override engine args. */
	engineArgs?: string;
	/** Extra env vars to merge. */
	env?: Record<string, string>;
	/** Custom workspace root (defaults to agent repo root). */
	agentRoot?: string;
	/** Reuse an existing HOME directory (for session restore tests). */
	home?: string;
	/** Session launch mode; defaults to a fresh session for test isolation. */
	sessionMode?: 'new' | 'continue';
	/** PTY columns (default 120). */
	cols?: number;
	/** PTY rows (default 40). */
	rows?: number;
};

/**
 * Create an E2E harness that boots the real CLI + Scala engine.
 * Real-engine tests intentionally do not pre-check Node-side LLM env vars:
 * the Scala engine owns model/key resolution and failures must surface as E2E
 * failures, not false skips.
 */
export async function createE2EHarness(t: TestContext, options: HarnessOptions = {}): Promise<E2EHarness> {
	const currentFile = fileURLToPath(import.meta.url);
	// helpers/e2eHarness.ts → helpers/ → integration/ → src/ → cli-ink/
	const cliInkRoot = path.resolve(path.dirname(currentFile), '..', '..', '..');
	const projectRoot = path.resolve(cliInkRoot, '..');
	const tsxCliPath = path.join(cliInkRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
	const mainPath = path.join(cliInkRoot, 'src', 'main.tsx');
	const agentRoot = options.agentRoot ?? projectRoot;

	const home = options.home ?? mkdtempSync(path.join(tmpdir(), 'fast-e2e-'));
	mkdirSync(path.join(home, '.fast'), {recursive: true});
	writeFileSync(
		path.join(home, '.fast', 'trusted-workspaces'),
		`${realpathSync.native(agentRoot)}\n`
	);

	const cols = options.cols ?? COLS;
	const rows = options.rows ?? ROWS;

	const env: Record<string, string | undefined> = {
		...process.env,
		HOME: home,
		NO_COLOR: '1',
		FORCE_COLOR: '0',
		FAST_E2E_STATE: '1',
		// Mock engines speak stdio NDJSON; never pull up Machine-scoped unix host in pty e2e.
		FAST_BRIDGE_TRANSPORT: 'stdio',
		FAST_SESSION: options.sessionMode === 'continue' ? undefined : 'new',
		FAST_AGENT_ROOT: agentRoot,
		...options.env,
	};
	if (env.FAST_SESSION === undefined) delete env.FAST_SESSION;

	if (options.engineCommand) {
		env.FAST_ENGINE_COMMAND = options.engineCommand;
		if (options.engineArgs) env.FAST_ENGINE_ARGS = options.engineArgs;
	} else {
		delete env.FAST_ENGINE_COMMAND;
		delete env.FAST_ENGINE_ARGS;
	}

	let child: ReturnType<typeof pty.spawn>;
	try {
		child = pty.spawn(process.execPath, [tsxCliPath, mainPath], {
			name: 'xterm-256color',
			cols,
			rows,
			cwd: agentRoot,
			env: env as Record<string, string>,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		t.skip(`node-pty unavailable: ${message}`);
		return null as unknown as E2EHarness;
	}

	const chunks: string[] = [];
	let transcript = '';
	let exited = false;

	child.onData(data => {
		chunks.push(data);
		transcript += data;
	});

	const exitPromise = new Promise<{exitCode: number}>(resolve => {
		child.onExit(event => {
			exited = true;
			resolve(event);
		});
	});

	const harness: E2EHarness = {
		get transcript() { return transcript; },
		get exited() { return exited; },
		get home() { return home; },

		async waitFor(predicate: () => boolean | Promise<boolean>, what: string, timeoutMs = 120_000) {
			const deadline = Date.now() + timeoutMs;
			while (!await predicate()) {
				if (exited) {
					throw new Error(`app exited before ${what}; transcript tail:\n${transcript.slice(-3000)}`);
				}
				if (Date.now() > deadline) {
					throw new Error(`timed out waiting for ${what} (${timeoutMs}ms); transcript tail:\n${transcript.slice(-3000)}`);
				}
				await new Promise(resolve => setTimeout(resolve, 80));
			}
		},

		async waitForScreen(pattern: string | RegExp, what: string, timeoutMs = 120_000) {
			await harness.waitFor(async () => matches(await harness.screenText(), pattern), what, timeoutMs);
		},

		async waitForScreenGone(pattern: string | RegExp, what: string, timeoutMs = 120_000) {
			await harness.waitFor(async () => !matches(await harness.screenText(), pattern), what, timeoutMs);
		},

		async expectScreenStaysGone(pattern: string | RegExp, what: string, durationMs = 5_000) {
			const deadline = Date.now() + durationMs;
			while (Date.now() <= deadline) {
				const screen = await harness.screenText();
				if (matches(screen, pattern)) {
					throw new Error(`${what} appeared unexpectedly; screen:\n${screen.slice(-3000)}`);
				}
				await new Promise(resolve => setTimeout(resolve, 120));
			}
		},

		async waitForIdle(timeoutMs = 120_000) {
			await harness.waitFor(async () => {
				const screen = await harness.screenText();
				return screen.includes('e2e:normal:idle');
			}, 'idle UI state', timeoutMs);
		},

		async screenText(): Promise<string> {
			const terminal = new Terminal({cols, rows, scrollback: 10000, allowProposedApi: true});
			await new Promise<void>(resolve => {
				terminal.write(chunks.join(''), () => resolve());
			});
			const buffer = terminal.buffer.active;
			const lines: string[] = [];
			for (let row = 0; row < buffer.length; row++) {
				const line = buffer.getLine(row);
				lines.push(line ? line.translateToString(true) : '');
			}
			return lines.join('\n');
		},

		async cursorPosition(): Promise<{x: number; y: number}> {
			const terminal = new Terminal({cols, rows, scrollback: 10000, allowProposedApi: true});
			await new Promise<void>(resolve => {
				terminal.write(chunks.join(''), () => resolve());
			});
			const buffer = terminal.buffer.active;
			return {x: buffer.cursorX, y: buffer.cursorY};
		},

		write(data: string) {
			if (!exited) child.write(data);
		},

		resize(cols: number, rows: number) {
			if (!exited) child.resize(cols, rows);
		},

		async submit(text: string) {
			child.write(text);
			const echoPrefix = text.slice(0, 30);
			await harness.waitFor(() => transcript.includes(echoPrefix), `composer echo "${echoPrefix}"`, 10_000);
			await new Promise(resolve => setTimeout(resolve, 200));
			child.write('\r');
		},

		cleanup() {
			if (!exited) {
				try { child.kill(); } catch { /* best-effort */ }
			}
		},

		async exitCode(): Promise<number> {
			const result = await Promise.race([
				exitPromise,
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('app did not exit within 20s')), 20_000)
				),
			]);
			return result.exitCode;
		},
	};

	return harness;
}

function matches(text: string, pattern: string | RegExp): boolean {
	return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
}

/**
 * Create a harness using the mock-engine (for protocol-level tests).
 */
export function createMockEngineHarness(
	t: TestContext,
	extraEnv?: Record<string, string>,
	options: Omit<HarnessOptions, 'engineCommand' | 'engineArgs' | 'env'> = {}
) {
	const currentFile = fileURLToPath(import.meta.url);
	const cliInkRoot = path.resolve(path.dirname(currentFile), '..', '..', '..');
	const mockEnginePath = path.join(cliInkRoot, 'scripts', 'mock-engine.mjs');

	return createE2EHarness(t, {
		...options,
		engineCommand: process.execPath,
		engineArgs: mockEnginePath,
		env: extraEnv,
	});
}

type ReplayHarnessOptions = Omit<HarnessOptions, 'engineCommand' | 'engineArgs' | 'env'>;

export function createReplayEngineHarness(
	t: TestContext,
	fixture: string,
	extraEnv?: Record<string, string>,
	options: ReplayHarnessOptions = {}
) {
	const currentFile = fileURLToPath(import.meta.url);
	const cliInkRoot = path.resolve(path.dirname(currentFile), '..', '..', '..');
	const replayEnginePath = path.join(cliInkRoot, 'scripts', 'replay-engine.mjs');
	const fixturePath = path.isAbsolute(fixture)
		? fixture
		: path.join(cliInkRoot, 'src', 'integration', 'fixtures', fixture);

	return createE2EHarness(t, {
		...options,
		engineCommand: process.execPath,
		engineArgs: `${replayEnginePath} ${fixturePath}`,
		env: extraEnv,
	});
}

export function createRecordedReplayHarness(
	t: TestContext,
	fixture: string,
	extraEnv?: Record<string, string>,
	options: ReplayHarnessOptions = {}
) {
	if (process.env.FAST_E2E_RECORD_EVENTS) {
		return createE2EHarness(t, {...options, env: extraEnv});
	}
	return createReplayEngineHarness(t, fixture, extraEnv, options);
}

/**
 * Gracefully exit via one idle Ctrl+C. Sending a second Ctrl+C can turn a
 * normal shutdown into SIGINT exit 130 while the engine process is still
 * draining.
 */
export async function gracefulExit(h: E2EHarness): Promise<number> {
	await h.waitForIdle();
	h.write('\u0003');
	return h.exitCode();
}
