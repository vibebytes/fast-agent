import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
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
				getLine: (index: number) => {translateToString: (trimRight?: boolean) => string} | undefined;
			};
		};
	};
};

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('PTY replay: final screen has no stale long-tail residue', {timeout: 120_000}, async t => {
	const currentFile = fileURLToPath(import.meta.url);
	const srcDir = path.dirname(path.dirname(currentFile));
	const projectRoot = path.dirname(srcDir);
	const tsxCliPath = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
	const replayRunnerPath = path.join(projectRoot, 'src', 'test-utils', 'ptyReplayRunner.tsx');
	const cols = 72;
	const rows = 28;

	const chunks: string[] = [];
	let child: ReturnType<typeof pty.spawn>;
	try {
		child = pty.spawn(process.execPath, [tsxCliPath, replayRunnerPath], {
			name: 'xterm-256color',
			cols,
			rows,
			cwd: projectRoot,
			env: {...process.env, NO_COLOR: '1', FORCE_COLOR: '0'}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		t.skip(`node-pty unavailable in this environment: ${message}`);
		return;
	}

	child.onData(data => {
		chunks.push(data);
	});

	const exitResult = await new Promise<{exitCode: number; signal?: number}>((resolve, reject) => {
		const timeout = setTimeout(() => {
			try {
				child.kill();
			} catch {
				// ignore kill errors on timeout path
			}
			reject(new Error('pty replay timeout'));
		}, 90_000);

		child.onExit(event => {
			clearTimeout(timeout);
			resolve(event);
		});
	});

	assert.equal(exitResult.exitCode, 0, 'pty replay runner should exit successfully');
	const transcript = chunks.join('');
	assert.match(transcript, /PTY-FINAL-MARK-121/);
	assert.match(transcript, /PTY-FINAL-STDERR-121/);

	const terminal = new Terminal({cols, rows, scrollback: 1000, allowProposedApi: true});
	await new Promise<void>(resolve => {
		terminal.write(transcript, () => resolve());
	});

	const buffer = terminal.buffer.active;
	const start = buffer.baseY;
	const lines: string[] = [];
	for (let row = 0; row < rows; row += 1) {
		const line = buffer.getLine(start + row);
		lines.push(line ? line.translateToString(true) : '');
	}
	const finalScreen = lines.join('\n');

	assert.match(finalScreen, /PTY-FINAL-MARK-121/);
	assert.doesNotMatch(finalScreen, new RegExp(escapeRegExp('PTY-LONG-SIGN-120')));
	assert.doesNotMatch(finalScreen, new RegExp(escapeRegExp('PTY-LONG-ERR-120')));
	assert.doesNotMatch(finalScreen, /\u001b\[\?2026[hl]/);
	assert.doesNotMatch(finalScreen, /\u001b\[K/);
});
