/**
 * PTY E2E: Slash command — user types /help and verifies help content renders.
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

test('PTY slash command: /help shows help content', {timeout: 120_000}, async t => {
	const currentFile = fileURLToPath(import.meta.url);
	const projectRoot = path.dirname(path.dirname(path.dirname(currentFile)));
	const tsxCliPath = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
	const mainPath = path.join(projectRoot, 'src', 'main.tsx');
	const mockEnginePath = path.join(projectRoot, 'scripts', 'mock-engine.mjs');
	const cols = 100;
	const rows = 32;

	const home = mkdtempSync(path.join(tmpdir(), 'fast-ink-slash-'));
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
		t.skip(`node-pty unavailable: ${message}`);
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
			if (exited) assert.fail(`app exited before ${what}; tail:\n${transcript.slice(-2000)}`);
			if (Date.now() > deadline) assert.fail(`timed out: ${what}; tail:\n${transcript.slice(-2000)}`);
			await new Promise(resolve => setTimeout(resolve, 50));
		}
	};

	let exitResult: {exitCode: number};
	try {
		await waitFor(() => transcript.includes('输入消息，或 /help 查看命令'), 'ready prompt', 30_000);

		// Type /help and submit.
		child.write('/help');
		await waitFor(() => transcript.includes('/help'), 'composer echo', 10_000);
		await new Promise(resolve => setTimeout(resolve, 200));
		child.write('\r');

		// The help content should appear. The client-side command registry handles
		// /help locally (toggleHelp), so we look for the help panel text.
		await waitFor(
			() => transcript.includes('/help') && (
				transcript.includes('Show help') ||
				transcript.includes('帮助') ||
				transcript.includes('COMMAND-HELP-RESULT')
			),
			'help content',
			20_000
		);

		// App should still be running (not exit on /help).
		assert.equal(exited, false, 'app should still be running after /help');

		// Dismiss the help dialog (Escape), then wait for idle and exit cleanly.
		await new Promise(resolve => setTimeout(resolve, 500));
		child.write('\u001B');
		// Wait for the idle marker AFTER Escape (use position tracking to avoid
		// matching boot-time occurrence).
		const escPos = transcript.length;
		await waitFor(() => transcript.slice(escPos).includes('e2e:normal:idle'), 'idle state after escape', 10_000);
		child.write('\u0003');

		exitResult = await Promise.race([
			exitPromise,
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('app did not exit')), 20_000))
		]);
	} finally {
		if (!exited) {
			try { child.kill(); } catch { /* best-effort */ }
		}
	}

	assert.equal(exitResult.exitCode, 0, 'app should exit cleanly');

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

	assert.doesNotMatch(screenText, /\u001b\[/);
});
