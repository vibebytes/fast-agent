/**
 * P3 fullscreen renderer end-to-end: boots the REAL app in a PTY against the
 * mock engine, switches into the alternate screen with /tui fullscreen, runs
 * a streamed turn inside the alt buffer, switches back to inline and verifies
 * that (a) the alt-screen enter/leave sequences are emitted, (b) the
 * transcript is repainted into the main buffer, and (c) exit restores the
 * terminal cleanly.
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
				length: number;
				getLine: (index: number) => {translateToString: (trimRight?: boolean) => string} | undefined;
			};
		};
	};
};

const ALT_ENTER = '\u001b[?1049h';
const ALT_LEAVE = '\u001b[?1049l';

test('PTY fullscreen: /tui switches alt-screen on/off, streams a turn, restores main buffer', {timeout: 120_000}, async t => {
	const currentFile = fileURLToPath(import.meta.url);
	const projectRoot = path.dirname(path.dirname(path.dirname(currentFile)));
	const tsxCliPath = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
	const mainPath = path.join(projectRoot, 'src', 'main.tsx');
	const mockEnginePath = path.join(projectRoot, 'scripts', 'mock-engine.mjs');
	const cols = 100;
	const rows = 32;

	const home = mkdtempSync(path.join(tmpdir(), 'fast-ink-fullscreen-'));
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

	const typeAndSubmit = async (text: string, what: string) => {
		child.write(text);
		await waitFor(() => transcript.includes(text), `${what} echo`, 10_000);
		await new Promise(resolve => setTimeout(resolve, 200));
		child.write('\r');
	};

	let exitResult: {exitCode: number};
	try {
		// 1. Boot in inline mode.
		await waitFor(() => transcript.includes('输入消息，或 /help 查看命令'), 'ready prompt', 30_000);
		assert.ok(!transcript.includes(ALT_ENTER), 'must not enter alt screen before /tui fullscreen');

		// 2. Switch to fullscreen: DECSET 1049 must be emitted.
		await typeAndSubmit('/tui fullscreen', 'tui fullscreen command');
		await waitFor(() => transcript.includes(ALT_ENTER), 'alternate screen enter', 10_000);

		// 3. Run a full streamed turn inside the alt buffer.
		const altStart = transcript.length;
		await typeAndSubmit('全屏模式冒烟', 'fullscreen message');
		await waitFor(() => transcript.includes('SMOKE-FINAL-DONE'), 'final answer in fullscreen', 30_000);
		assert.ok(
			transcript.slice(altStart).includes('SMOKE-FINAL-DONE'),
			'final answer must render inside the fullscreen session'
		);
		await new Promise(resolve => setTimeout(resolve, 500));

		// 4. Switch back to inline: DECSET 1049 reset + transcript repaint.
		await typeAndSubmit('/tui inline', 'tui inline command');
		await waitFor(() => transcript.includes(ALT_LEAVE), 'alternate screen leave', 10_000);
		const mainStart = transcript.lastIndexOf(ALT_LEAVE);
		await waitFor(
			() => transcript.slice(mainStart).includes('SMOKE-FINAL-DONE'),
			'transcript repaint in main buffer',
			10_000
		);
		await new Promise(resolve => setTimeout(resolve, 500));

		// 5. Clean exit: wait for idle, then single Ctrl+C.
		await waitFor(() => transcript.includes('e2e:normal:idle'), 'idle state', 10_000);
		child.write('\u0003');

		exitResult = await Promise.race([
			exitPromise,
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('app did not exit after Ctrl+C')), 20_000))
		]);
	} finally {
		if (!exited) {
			try {
				child.kill();
			} catch {
				// best-effort cleanup
			}
		}
	}
	assert.equal(exitResult.exitCode, 0, 'app should exit cleanly');

	// 6. After exit the terminal must be back on the main buffer: every enter
	// is paired with a leave, and the last 1049 toggle is a leave.
	const enters = transcript.split(ALT_ENTER).length - 1;
	const leaves = transcript.split(ALT_LEAVE).length - 1;
	assert.ok(enters >= 1, 'expected at least one alt-screen enter');
	assert.ok(leaves >= enters, `every enter needs a leave (enters=${enters}, leaves=${leaves})`);
	assert.ok(
		transcript.lastIndexOf(ALT_LEAVE) > transcript.lastIndexOf(ALT_ENTER),
		'terminal must end on the main buffer'
	);

	// 7. Replay through a real terminal emulator: the final main-buffer screen
	// must contain the repainted transcript with no leaked escapes.
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
	assert.match(screenText, /SMOKE-FINAL-DONE/);
	assert.match(screenText, /全屏模式冒烟/);
	assert.doesNotMatch(screenText, /\u001b\[/);
});
