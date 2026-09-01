/**
 * Probe the developer's LIVE Machine Bridge (~/.fast/run):
 * Hello as ink → EnsureProject(nano-agent) → expect command_result + Attach path.
 * Does not spawn/kill the daemon.
 */
import {readFileSync, existsSync} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const runDir = process.env.FAST_RUN_DIR ?? path.join(home, '.fast', 'run');
const sock = path.join(runDir, 'bridge.sock');
const tokenFile = path.join(runDir, 'bridge.token');
const inkCwd = process.env.FAST_INK_CWD ?? process.cwd();
const t0 = Date.now();
const log = m => console.log(`[${Date.now() - t0}ms] ${m}`);

if (!existsSync(sock) || !existsSync(tokenFile)) {
	console.error(`missing sock/token under ${runDir}`);
	process.exit(2);
}
const token = readFileSync(tokenFile, 'utf8').trim();
const clientId = `live-probe-ink-${Date.now()}`;

const events = [];
let buf = '';
const sockConn = net.createConnection({path: sock});

function send(obj) {
	sockConn.write(JSON.stringify(obj) + '\n');
	log(`SEND ${obj.type}${obj.name ? ' ' + obj.name : ''}${obj.path ? ' ' + obj.path : ''}`);
}

await new Promise((resolve, reject) => {
	sockConn.once('connect', resolve);
	sockConn.once('error', reject);
});
log('connected');

sockConn.on('data', chunk => {
	buf += String(chunk);
	let idx;
	while ((idx = buf.indexOf('\n')) >= 0) {
		const line = buf.slice(0, idx).trim();
		buf = buf.slice(idx + 1);
		if (!line.startsWith('{')) continue;
		try {
			const e = JSON.parse(line);
			events.push(e);
			const detail = [
				e.type,
				e.name,
				e.status,
				e.sessionId ? `sid=${e.sessionId.slice(0, 8)}` : '',
				e.projectId ? `pid=${e.projectId.slice(0, 8)}` : '',
				e.cwd ? `cwd=${e.cwd}` : '',
				e.message ? `msg=${String(e.message).slice(0, 80)}` : ''
			]
				.filter(Boolean)
				.join(' ');
			log(`RECV ${detail}`);
		} catch (err) {
			log(`PARSE_FAIL ${line.slice(0, 120)}`);
		}
	}
});

send({
	type: 'Hello',
	protocolVersion: 1,
	clientId,
	clientKind: 'fast-ink',
	pid: process.pid,
	cwd: inkCwd,
	authToken: token
});

await waitFor(() => events.some(e => e.type === 'HelloOk'), 'HelloOk', 10_000);
send({
	type: 'EnsureProject',
	path: inkCwd,
	projectType: 'coding',
	displayName: 'nano-agent'
});

const ep = await waitFor(
	() => events.some(e => e.type === 'command_result' && e.name === 'EnsureProject'),
	'EnsureProject command_result',
	30_000
).catch(err => {
	log(`FAIL ${err.message}`);
	log(`events so far: ${events.map(e => e.type + (e.name ? ':' + e.name : '')).join(',')}`);
	return null;
});

if (ep) {
	const cr = events.find(e => e.type === 'command_result' && e.name === 'EnsureProject');
	log(`EnsureProject status=${cr.status} projectId=${cr.projectId ?? '∅'} msg=${cr.message ?? ''}`);
	if (cr.status === 'accepted' && cr.projectId) {
		send({type: 'GetWorkspaceMeta'});
		await waitFor(() => events.some(e => e.type === 'workspace_meta'), 'workspace_meta', 15_000).catch(e =>
			log(`meta fail ${e.message}`)
		);
		const meta = [...events].reverse().find(e => e.type === 'workspace_meta');
		const sessions = meta?.sessionsByProjectId?.[cr.projectId] ?? [];
		log(`sessions for project: ${sessions.length}`);
		if (sessions[0]?.id) {
			send({
				type: 'AttachSession',
				sessionId: sessions[0].id,
				clientId,
				lastEventSeq: 0,
				limit: 50
			});
			await waitFor(() => events.some(e => e.type === 'Attached'), 'Attached', 15_000).catch(e =>
				log(`Attach fail ${e.message}`)
			);
		} else {
			send({type: 'CreateSession', projectId: cr.projectId, title: 'nano-agent'});
			await waitFor(
				() => events.some(e => e.type === 'command_result' && e.name === 'CreateSession'),
				'CreateSession',
				15_000
			).catch(e => log(`CreateSession fail ${e.message}`));
		}
	}
}

send({type: 'Goodbye', clientId});
await new Promise(r => setTimeout(r, 200));
sockConn.destroy();
log(
	`done types=${events
		.map(e => (e.type === 'command_result' ? `${e.type}:${e.name}:${e.status}` : e.type))
		.join(',')}`
);

function waitFor(pred, label, timeoutMs) {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		const tick = () => {
			if (pred()) return resolve(true);
			if (Date.now() - start > timeoutMs) return reject(new Error(`timeout ${label}`));
			setTimeout(tick, 50);
		};
		tick();
	});
}
