/**
 * Ghost-frame regression: replays the real "deep analysis" flow (long
 * thinking → 6 parallel shells → second long thinking with an animating
 * spinner) inside a true PTY, then parses the full transcript with a real
 * terminal emulator. Any leftover "Thinking … ctrl+c" rows in the final
 * buffer are ghost frames — dynamic rows Ink failed to erase.
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

test('PTY ghosts: long thinking + parallel shells leaves no residual Thinking rows', {timeout: 120_000}, async t => {
	const currentFile = fileURLToPath(import.meta.url);
	const projectRoot = path.dirname(path.dirname(path.dirname(currentFile)));
	const tsxCliPath = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
	const mainPath = path.join(projectRoot, 'src', 'main.tsx');
	const mockEnginePath = path.join(projectRoot, 'scripts', 'mock-engine.mjs');
	const cols = 100;
	const rows = 32;

	const home = mkdtempSync(path.join(tmpdir(), 'fast-ink-ghost-'));
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

	try {
		await waitFor(() => transcript.includes('输入消息，或 /help 查看命令'), 'ready prompt', 30_000);

		child.write('深度分析当前服务器的性能瓶颈');
		await waitFor(() => transcript.includes('深度分析当前服务器的性能瓶颈'), 'composer echo', 10_000);
		await new Promise(resolve => setTimeout(resolve, 200));
		child.write('\r');

		await waitFor(() => transcript.includes('GHOST-FINAL-DONE'), 'final answer', 60_000);
		await new Promise(resolve => setTimeout(resolve, 500));

		child.write('\u0003');
		setTimeout(() => {
			if (!exited) child.write('\u0003');
		}, 1500).unref();

		await Promise.race([
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

	assert.match(screenText, /GHOST-FINAL-DONE/);

	// THE assertion: after the turn finishes, the live "Thinking … ctrl+c"
	// row must be fully erased. Every surviving copy is a ghost frame.
	const ghostRows = allLines.filter(line => /Thinking/.test(line) && /ctrl\+c/.test(line));
	assert.equal(
		ghostRows.length, 0,
		`found ${ghostRows.length} residual Thinking rows (ghost frames):\n${ghostRows.slice(0, 10).join('\n')}`
	);

	// The final answer renders exactly once (no duplicated static history).
	const finalCount = screenText.match(/GHOST-FINAL-DONE/g)?.length ?? 0;
	assert.equal(finalCount, 1, `final answer should render exactly once, saw ${finalCount}`);
});
