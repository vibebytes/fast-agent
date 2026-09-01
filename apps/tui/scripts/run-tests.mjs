/**
 * Batches (pick one argv; default = unit):
 *   unit  — `pnpm test`
 *   e2e   — integration except pty and real-unix
 *   pty
 *   unix  — real JVM; opt-in only (`FAST_UNIX_E2E=1`)
 *
 * Unix e2e is skipped unless FAST_UNIX_E2E=1. Presence of a local engine
 * binary is not a reason to run it.
 *
 * Each batch has a wall clock. On timeout the process group is SIGKILL'd
 * (tsx + any JVM children). Override with FAST_TEST_WALL_MS.
 */
import {readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const src = join(root, 'src');

process.env['TERM'] ??= 'xterm-256color';
if (process.env['FORCE_COLOR'] === undefined && process.env['NO_COLOR'] === undefined) {
	process.env['FORCE_COLOR'] = '1';
}

const want = process.argv[2] ?? 'unit';
const known = new Set(['unit', 'e2e', 'pty', 'unix']);
if (!known.has(want)) {
	console.error(`unknown batch "${want}". use: unit | e2e | pty | unix`);
	process.exit(2);
}

if (want === 'unix') {
	process.env.FAST_UNIX_E2E = '1';
	delete process.env.FAST_SKIP_UNIX_E2E;
} else if (process.env.FAST_UNIX_E2E !== '1') {
	process.env.FAST_SKIP_UNIX_E2E = '1';
}

function collect(dir) {
	const entries = readdirSync(dir, {withFileTypes: true});
	const files = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collect(path));
			continue;
		}
		if (/\.test\.tsx?$/.test(entry.name) && statSync(path).isFile()) {
			files.push(path);
		}
	}
	return files;
}

const testFiles = collect(src).sort();
if (testFiles.length === 0) {
	console.error('No test files found.');
	process.exit(1);
}

const isPty = file => /integration\/pty/.test(file);
const isUnix = file => /\/unix[^/]*\.e2e\.test\.tsx?$/.test(file);
const isE2e = file => /integration\//.test(file) && !isPty(file) && !isUnix(file);

const walls = {
	unit: 120_000,
	e2e: 180_000,
	pty: 180_000,
	unix: 300_000
};
const wallMs = Number(process.env.FAST_TEST_WALL_MS) || walls[want];

const batches = {
	unit: {name: 'unit', args: ['--test-concurrency=4', '--test-timeout=30000'], files: testFiles.filter(f => !isPty(f) && !isE2e(f) && !isUnix(f))},
	e2e: {name: 'e2e', args: ['--test-concurrency=2', '--test-timeout=30000'], files: testFiles.filter(isE2e)},
	pty: {name: 'pty', args: ['--test-concurrency=2', '--test-timeout=30000'], files: testFiles.filter(isPty)},
	unix: {name: 'unix', args: ['--test-concurrency=2'], files: testFiles.filter(isUnix)}
};

const batch = batches[want];
if (batch.files.length === 0) {
	console.error(`Test batch "${batch.name}" has no files.`);
	process.exit(1);
}

function killGroup(pid) {
	if (pid == null) return;
	if (process.platform === 'win32') {
		spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {stdio: 'ignore'});
		return;
	}
	try {
		process.kill(-pid, 'SIGKILL');
	} catch {
		try {
			process.kill(pid, 'SIGKILL');
		} catch {
			/* already gone */
		}
	}
}

const child = spawn('tsx', ['--test', ...batch.args, ...batch.files], {
	cwd: root,
	stdio: 'inherit',
	shell: false,
	env: process.env,
	detached: process.platform !== 'win32'
});

const timer = setTimeout(() => {
	console.error(`Test batch "${batch.name}" exceeded ${wallMs}ms; killing process group`);
	killGroup(child.pid);
}, wallMs);

child.on('error', err => {
	clearTimeout(timer);
	console.error(err);
	process.exit(1);
});

child.on('exit', (code, signal) => {
	clearTimeout(timer);
	if (signal === 'SIGKILL') {
		console.error(`Test batch "${batch.name}" killed (${signal}).`);
		process.exit(1);
	}
	process.exit(code ?? 1);
});
