/**
 * Self-verify open path with IDE peer against LIVE ~/.fast/run daemon.
 * Asserts ink receives EnsureProject + Attached; prints verdict for humans.
 */
import {readFileSync, existsSync, openSync, readSync, closeSync, fstatSync} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const runDir = path.join(home, '.fast', 'run');
const sock = path.join(runDir, 'bridge.sock');
const tokenFile = path.join(runDir, 'bridge.token');
const cliLog = path.join(home, '.fast', 'logs', 'cli.log');
const inkCwd = process.env.FAST_INK_CWD ?? process.cwd();
const ideCwd = process.env.FAST_IDE_CWD ?? process.cwd();
const t0 = Date.now();
const log = (who, m) => console.log(`[${Date.now() - t0}ms][${who}] ${m}`);

if (!existsSync(sock) || !existsSync(tokenFile)) {
	console.error(`FAIL: missing sock/token under ${runDir}`);
	process.exit(2);
}
const token = readFileSync(tokenFile, 'utf8').trim();
const logOffset = existsSync(cliLog) ? fstatSync(openSync(cliLog, 'r')).size : 0;

function client(who, cwd, kind) {
	const events = [];
	const c = net.createConnection({path: sock});
	let buf = '';
	const connected = new Promise((resolve, reject) => {
		c.once('connect', resolve);
		c.once('error', reject);
	});
	c.on('data', chunk => {
		buf += String(chunk);
		let i;
		while ((i = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, i).trim();
			buf = buf.slice(i + 1);
			if (!line.startsWith('{')) continue;
			const e = JSON.parse(line);
			events.push(e);
			log(
				who,
				`RECV ${e.type}${e.name ? ':' + e.name : ''}${e.status ? ':' + e.status : ''}` +
					`${e.projectId ? ' pid=' + String(e.projectId).slice(0, 8) : ''}` +
					`${e.sessionId ? ' sid=' + String(e.sessionId).slice(0, 8) : ''}` +
					`${e.cwd ? ' cwd=' + e.cwd : ''}`
			);
		}
	});
	return {
		events,
		async hello(clientId) {
			await connected;
			c.write(
				JSON.stringify({
					type: 'Hello',
					protocolVersion: 1,
					clientId,
					clientKind: kind,
					pid: process.pid,
					cwd,
					authToken: token
				}) + '\n'
			);
			await wait(() => events.some(e => e.type === 'HelloOk'), `${who} HelloOk`, 15_000);
		},
		send(o) {
			c.write(JSON.stringify(o) + '\n');
			log(who, `SEND ${o.type}${o.path ? ' ' + o.path : ''}${o.sessionId ? ' ' + o.sessionId.slice(0, 8) : ''}`);
		},
		close() {
			try {
				c.write(JSON.stringify({type: 'Goodbye', clientId: 'x'}) + '\n');
			} catch {
				/* ignore */
			}
			c.destroy();
		}
	};
}

function wait(pred, label, ms) {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		const tick = () => {
			if (pred()) return resolve();
			if (Date.now() - start > ms) return reject(new Error(`timeout ${label}`));
			setTimeout(tick, 40);
		};
		tick();
	});
}

function readNewLogs() {
	if (!existsSync(cliLog)) return '';
	const fd = openSync(cliLog, 'r');
	try {
		const size = fstatSync(fd).size;
		const start = Math.min(logOffset, size);
		const len = size - start;
		if (len <= 0) return '';
		const buf = Buffer.alloc(len);
		readSync(fd, buf, 0, len, start);
		return buf.toString('utf8');
	} finally {
		closeSync(fd);
	}
}

const ide = client('ide', ideCwd, 'fast-ide');
const ink = client('ink', inkCwd, 'fast-ink');
let verdict = 'FAIL';
let detail = '';

try {
	await ide.hello(`verify-ide-${Date.now()}`);
	await ink.hello(`verify-ink-${Date.now()}`);

	ink.send({
		type: 'EnsureProject',
		path: inkCwd,
		projectType: 'coding',
		displayName: 'nano-agent'
	});

	await wait(
		() => ink.events.some(e => e.type === 'command_result' && e.name === 'EnsureProject'),
		'ink EnsureProject command_result',
		30_000
	);
	const ep = ink.events.find(e => e.type === 'command_result' && e.name === 'EnsureProject');
	if (ep.status !== 'accepted' || !ep.projectId) {
		throw new Error(`EnsureProject bad status=${ep.status}`);
	}
	log('ink', `EnsureProject OK projectId=${ep.projectId.slice(0, 8)}`);

	// Pollute TLS path: IDE also asks GetWorkspaceMeta while ink continues boot.
	ide.send({type: 'GetWorkspaceMeta'});

	ink.send({type: 'GetWorkspaceMeta'});
	await wait(
		() => ink.events.some(e => e.type === 'command_result' && e.name === 'GetWorkspaceMeta'),
		'ink GetWorkspaceMeta',
		20_000
	);

	const meta = [...ink.events].reverse().find(e => e.type === 'workspace_meta');
	const sessions = meta?.sessionsByProjectId?.[ep.projectId] ?? [];
	if (sessions[0]?.id) {
		ink.send({
			type: 'AttachSession',
			sessionId: sessions[0].id,
			clientId: `verify-ink-attach`,
			lastEventSeq: 0,
			limit: 50
		});
	} else {
		ink.send({type: 'CreateSession', projectId: ep.projectId, title: 'nano-agent'});
		await wait(
			() => ink.events.some(e => e.type === 'command_result' && e.name === 'CreateSession' && e.status === 'accepted'),
			'CreateSession',
			20_000
		);
		const cs = ink.events.find(e => e.type === 'command_result' && e.name === 'CreateSession');
		ink.send({
			type: 'AttachSession',
			sessionId: cs.sessionId,
			clientId: `verify-ink-attach`,
			lastEventSeq: 0,
			limit: 50
		});
	}
	await wait(() => ink.events.some(e => e.type === 'Attached'), 'Attached', 20_000);

	const ideStole = ide.events.some(
		e => e.type === 'command_result' && e.name === 'EnsureProject' && e.projectId === ep.projectId
	);
	// IDE may also EnsureProject separately — only fail if ink never got its own.
	const inkAttached = ink.events.some(e => e.type === 'Attached');
	if (!inkAttached) throw new Error('ink never Attached');

	verdict = 'PASS';
	detail = `ink EnsureProject+Attached ok; ideEnsureProjectSeen=${ideStole}`;
} catch (e) {
	verdict = 'FAIL';
	detail = e instanceof Error ? e.message : String(e);
} finally {
	ide.close();
	ink.close();
}

await new Promise(r => setTimeout(r, 300));
const newLogs = readNewLogs();
const routeLines = newLogs
	.split('\n')
	.filter(l => /bridge route command_result|EnsureProject enqueue|GetWorkspaceMeta enqueue/.test(l));

console.log('\n======== SERVER LOG (new) ========');
console.log(routeLines.length ? routeLines.join('\n') : '(no route log lines — jar may lack logging or log not flushing)');
console.log('======== CLIENT SUMMARY ========');
console.log(
	`ink types=${ink.events.map(e => (e.type === 'command_result' ? `${e.type}:${e.name}:${e.status}` : e.type)).join(',')}`
);
console.log(
	`ide types=${ide.events.map(e => (e.type === 'command_result' ? `${e.type}:${e.name}:${e.status}` : e.type)).join(',')}`
);
console.log(`\nVERDICT: ${verdict} — ${detail}`);
process.exit(verdict === 'PASS' ? 0 : 1);
