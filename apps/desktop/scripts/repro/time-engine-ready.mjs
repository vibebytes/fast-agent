#!/usr/bin/env node
/**
 * Time cold Bridge Engine until ready + workspace_meta (stdio).
 * Usage: node scripts/repro/time-engine-ready.mjs
 */
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {currentEngineCli} from '../../../../scripts/current-engine.mjs';

const agentCli = currentEngineCli();
if (!agentCli) {
	console.error('missing modules/engine/current/bin/fast-cli — pnpm fetch-engine');
	process.exit(1);
}
const cwd = join(homedir(), 'fast_workspace');
mkdirSync(cwd, {recursive: true});

const t0 = Date.now();
const child = spawn('/bin/sh', [agentCli, 'engine', '--mode', 'bridge', '--transport', 'stdio', '--new'], {
	cwd,
	stdio: ['pipe', 'pipe', 'pipe']
});

let buf = '';
let readyT = null;
let metaT = null;
const errLines = [];

function elapsed() {
	return ((Date.now() - t0) / 1000).toFixed(2);
}

const timer = setTimeout(() => {
	console.error(`TIMEOUT after ${elapsed()}s ready=${readyT} meta=${metaT}`);
	child.kill('SIGTERM');
	process.exit(2);
}, 180_000);

child.stderr.on('data', chunk => {
	for (const line of String(chunk).split('\n')) {
		if (line.trim()) {
			errLines.push(line.trim().slice(0, 220));
			if (errLines.length > 40) errLines.shift();
		}
	}
});

child.stdout.on('data', chunk => {
	buf += String(chunk);
	for (;;) {
		const i = buf.indexOf('\n');
		if (i < 0) break;
		const line = buf.slice(0, i).trim();
		buf = buf.slice(i + 1);
		if (!line.startsWith('{')) continue;
		let ev;
		try {
			ev = JSON.parse(line);
		} catch {
			continue;
		}
		if (ev.type === 'ready' && readyT == null) {
			readyT = Number(elapsed());
			console.log(`ready at ${readyT}s`);
			child.stdin.write(`${JSON.stringify({type: 'GetWorkspaceMeta'})}\n`);
		} else if (ev.type === 'workspace_meta' && metaT == null) {
			metaT = Number(elapsed());
			const n = Array.isArray(ev.projects) ? ev.projects.length : 0;
			console.log(`workspace_meta at ${metaT}s projects=${n}`);
			clearTimeout(timer);
			child.kill('SIGTERM');
			console.log(`SUMMARY ready=${readyT} meta=${metaT}`);
			process.exit(0);
		} else if (ev.type === 'error') {
			console.log(`error at ${elapsed()}s: ${ev.message}`);
		} else if (ev.type === 'command_result' && ev.name === 'GetWorkspaceMeta') {
			console.log(`GetWorkspaceMeta result at ${elapsed()}s ok=${ev.ok} msg=${ev.message ?? ''}`);
		}
	}
});

child.on('exit', (code, signal) => {
	clearTimeout(timer);
	console.log(`exited code=${code} signal=${signal} after ${elapsed()}s ready=${readyT} meta=${metaT}`);
	if (errLines.length) {
		console.log('STDERR tail:');
		for (const l of errLines.slice(-20)) console.log(' ', l);
	}
	process.exit(metaT != null ? 0 : 1);
});
