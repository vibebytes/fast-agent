/**
 * End-to-end TUI smoke: boots the REAL app (src/main.tsx) inside a true
 * pseudo-terminal against a mock bridge engine, types a message, streams a
 * full turn (CJK text + tool output) and verifies the final screen content
 * through a headless xterm parser. This is the closest automated equivalent
 * to a human running the CLI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtempSync, mkdirSync, writeFileSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import * as pty from 'node-pty';

const require = createRequire(import.meta.url);
const {Terminal} = require('@xterm/headless') as {
	Terminal: new (options?: {cols?: number; rows?: number; scrollback?: number; allowProposedApi?: boolean}) => {
		write: (data: string, callback?: () => void) => void;
		buffer: {
			active: {
				baseY: number;
				length: number;
				getLine: (index: number) => {translateToString: (trimRight?: boolean) => string} | undefined;
			};
		};
	};
};

test('PTY app smoke: real TUI boots, streams a CJK turn with tool output, exits cleanly', {timeout: 120_000}, async t => {
	const currentFile = fileURLToPath(import.meta.url);
	const projectRoot = path.dirname(path.dirname(path.dirname(currentFile)));
	const tsxCliPath = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
	const mainPath = path.join(projectRoot, 'src', 'main.tsx');
	const mockEnginePath = path.join(projectRoot, 'scripts', 'mock-engine.mjs');
	const cols = 100;
	const rows = 32;

	// Isolated HOME with the workspace pre-trusted, so the trust dialog never blocks.
	const home = mkdtempSync(path.join(tmpdir(), 'fast-ink-smoke-'));
	mkdirSync(path.join(home, '.fast'), {recursive: true});
	writeFileSync(path.join(home, '.fast', 'trusted-workspaces'), `${realpathSync.native(projectRoot)}\n`);

	let child: ReturnType<typeof pty.spawn>;
	try {
		child = pty.spawn(process.execPath, [tsxCliPath, mainPath], {
			name: 'xterm-256color',
			cols,
			rows,
			cwd: projectRoot,
			env: {
				...process.env,
				HOME: home,
				NO_COLOR: '1',
				FORCE_COLOR: '0',
				FAST_E2E_STATE: '1',
				FAST_AGENT_ROOT: projectRoot,
				FAST_ENGINE_COMMAND: process.execPath,
				FAST_ENGINE_ARGS: mockEnginePath
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		t.skip(`node-pty unavailable in this environment: ${message}`);
		return;
	}

	const chunks: string[] = [];
	let transcript = '';
	child.onData(data => {
		chunks.push(data);
		transcript += data;
	});

	let exited = false;
	const exitPromise = new Promise<{exitCode: number}>(resolve => {
		child.onExit(event => {
			exited = true;
			resolve(event);
		});
	});

	const waitFor = async (predicate: () => boolean, what: string, timeoutMs: number) => {
		const deadline = Date.now() + timeoutMs;
		while (!predicate()) {
			if (exited) {
				assert.fail(`app exited before ${what}; transcript tail:\n${transcript.slice(-2000)}`);
			}
			if (Date.now() > deadline) {
				assert.fail(`timed out waiting for ${what}; transcript tail:\n${transcript.slice(-2000)}`);
			}
			await new Promise(resolve => setTimeout(resolve, 50));
		}
	};

	let exitResult: {exitCode: number};
	try {
		// 1. App boots and the mock engine reports ready.
		await waitFor(() => transcript.includes('输入消息，或 /help 查看命令'), 'ready prompt', 30_000);

		// 2. Type a message and run a full streamed turn. The carriage return is
		// written separately: inside one chunk it would be treated as pasted text
		// instead of a submit keypress.
		child.write('帮我跑一次冒烟测试');
		await waitFor(() => transcript.includes('帮我跑一次冒烟测试'), 'composer echo', 10_000);
		await new Promise(resolve => setTimeout(resolve, 200));
		child.write('\r');
		// The thinking indicator (spinner header) must surface while the turn runs.
		// Guards the "thinking 过程没有了" regression where the optimistic running
		// state never rendered after submit.
		await waitFor(() => transcript.includes('Thinking'), 'thinking indicator', 20_000);
		await waitFor(() => transcript.includes('SMOKE-TOOL-LINE'), 'tool output', 20_000);
		await waitFor(() => transcript.includes('SMOKE-FINAL-DONE'), 'final answer', 20_000);

		// Let the last frame settle before exiting.
		await new Promise(resolve => setTimeout(resolve, 500));

		// 3. Wait for idle state, then single Ctrl+C for clean exit.
		await waitFor(() => transcript.includes('e2e:normal:idle'), 'idle state', 10_000);
		child.write('\u0003');

		exitResult = await Promise.race([
			exitPromise,
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('app did not exit after Ctrl+C')), 20_000))
		]);
	} finally {
		// Never leave the PTY child alive: a surviving child keeps the test
		// runner's event loop busy forever on the failure path.
		if (!exited) {
			try {
				child.kill();
			} catch {
				// best-effort cleanup
			}
		}
	}
	assert.equal(exitResult.exitCode, 0, 'app should exit cleanly');

	// 4. Replay the full transcript through a real terminal emulator and check
	//    the visible screen + scrollback for correctness markers.
	const terminal = new Terminal({cols, rows, scrollback: 5000, allowProposedApi: true});
	await new Promise<void>(resolve => {
		terminal.write(chunks.join(''), () => resolve());
	});

	const buffer = terminal.buffer.active;
	const allLines: string[] = [];
	for (let row = 0; row < buffer.length; row += 1) {
		const line = buffer.getLine(row);
		allLines.push(line ? line.translateToString(true) : '');
	}
	const screenText = allLines.join('\n');

	// Final answer and CJK tool output must be visible (in screen or scrollback).
	assert.match(screenText, /SMOKE-FINAL-DONE/);
	assert.match(screenText, /SMOKE-TOOL-LINE/);
	assert.match(screenText, /中文输出行/);
	// User echo and welcome banner are present.
	assert.match(screenText, /帮我跑一次冒烟测试/);
	// No raw escape sequences may leak into the parsed text.
	assert.doesNotMatch(screenText, /\u001b\[/);

	// The final marker must appear exactly once in the parsed terminal content:
	// duplicates mean Static history was repainted/duplicated into scrollback.
	const finalMarkCount = screenText.match(/SMOKE-FINAL-DONE/g)?.length ?? 0;
	assert.equal(finalMarkCount, 1, `final answer should render exactly once, saw ${finalMarkCount}`);
});
