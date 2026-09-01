// Probe: does the engine mirror a BUSY-submitted text into the transcript
// at enqueue time (before any interrupt)? And when does the user entry land
// relative to InterruptWithMessage?
import {mkdtempSync} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {BridgeHost, tryConnectUnix} from '@fastllm/bridge-client';

const SOCKET = join(homedir(), '.fast/run/bridge.sock');
const accepting = await tryConnectUnix(SOCKET, 2_000);
if (!accepting) {
	console.info('NO-LIVE-HOST');
	process.exit(0);
}
const workspaceRoot = mkdtempSync(join(tmpdir(), 'queue-echo-probe-'));
const events = [];
const host = new BridgeHost();
await host.connect(
	{clientKind: 'fast-ide', clientId: `probe-${randomUUID()}`, cwd: workspaceRoot, heartbeatMs: 0},
	{onEvent: e => events.push(e), onError: m => console.error(`[err] ${m}`), onClose: () => undefined}
);

const until = async (probe, pred, ms, label) => {
	const end = Date.now() + ms;
	let cur = probe();
	while (cur == null || !pred(cur)) {
		if (Date.now() > end) throw new Error(`timeout: ${label}`);
		await new Promise(r => setTimeout(r, 25));
		cur = probe();
	}
	return cur;
};
const result = async name =>
	until(
		() => events.find(e => e.type === 'command_result' && e.name === name),
		e => e?.status !== undefined,
		60_000,
		name
	);

try {
	host.send({type: 'CreateProject', projectType: 'coding', rootPath: workspaceRoot, displayName: 'probe'});
	const project = await result('CreateProject');
	if (project.status !== 'accepted') throw new Error(`CreateProject: ${project.message}`);
	const projectId = String(project.projectId ?? '');
	const taskId = `task-${randomUUID()}`;
	host.send({type: 'CreateSession', projectId, title: 'queue-echo-probe', taskId});
	const created = await result('CreateSession');
	if (created.status !== 'accepted') throw new Error(`CreateSession: ${created.message}`);
	const sessionId = String(created.sessionId ?? '');
	host.send({type: 'AttachSession', sessionId, clientId: `cli-${taskId}`, lastEventSeq: 0, limit: 20});

	const t0 = Date.now();
	host.send({
		type: 'SubmitUserMessage',
		sessionId,
		clientMessageId: `c1-${Date.now()}`,
		text: '请写一篇约2000字的短文，主题是深海城市。直接输出正文。'
	});
	await until(
		() => events.some(e => e.type === 'assistant_delta' || e.type === 'reasoning_delta'),
		ok => ok,
		120_000,
		'turn1 progress'
	);
	console.info(`[t+] turn1 streaming at ${Date.now() - t0}ms`);

	const PROBE = `QUEUED_PROBE_${Date.now()}`;
	const tQ = Date.now();
	host.send({type: 'SubmitUserMessage', sessionId, clientMessageId: `c2-${Date.now()}`, text: PROBE});
	await until(
		() => events.some(e => e.type === 'command_result' && e.status === 'queued' && Date.now() >= tQ),
		ok => ok,
		30_000,
		'busy submit queued'
	);
	console.info(`[t+] busy submit QUEUED at +${Date.now() - tQ}ms`);

	// Watch 4s: does ANY event carry the probe text as a transcript/user entry?
	const seen = [];
	for (const e of events) {
		const s = JSON.stringify(e);
		if (s.includes(PROBE)) seen.push(`${e.type}@+${Date.now() - tQ}ms`);
	}
	await new Promise(r => setTimeout(r, 4_000));
	for (const e of events) {
		const s = JSON.stringify(e);
		if (s.includes(PROBE) && !seen.includes(`${e.type}@${(Date.now() - tQ) | 0}ms`)) {
			if (!seen.some(x => x.startsWith(`${e.type}@`))) seen.push(`${e.type}@+${Date.now() - tQ}ms`);
		}
	}
	console.info(`[enqueue-mirror] events containing probe text: ${seen.length ? seen.join(', ') : 'NONE'}`);

	const fu = [...events].reverse().find(e => e.type === 'follow_up_changed');
	console.info(`[follow_up] ${fu ? String(fu.itemsJson).slice(0, 200) : 'none'}`);

	const itemId = (() => {
		try {
			const items = JSON.parse(String(fu?.itemsJson ?? '[]'));
			return String(items[items.length - 1]?.id ?? '');
		} catch {
			return '';
		}
	})();
	const tI = Date.now();
	host.send({
		type: 'InterruptWithMessage',
		sessionId,
		text: PROBE,
		clientMessageId: `c3-${Date.now()}`,
		itemId
	});
	const ack = await until(
		() => events.find(e => e.type === 'command_result' && e.name === 'InterruptWithMessage'),
		e => e?.status !== undefined,
		45_000,
		'interrupt ack'
	);
	console.info(`[interrupt] ack=${ack.status} "${String(ack.message).slice(0, 60)}" at +${Date.now() - tI}ms`);

	await until(
		() => events.some(e => e.type === 'turn_started' && String(e.clientMessageId ?? '').includes('c3')),
		ok => ok,
		45_000,
		'turn2 start'
	);
	console.info(`[turn2] started at +${Date.now() - tI}ms after interrupt`);

	const mirrored = [];
	for (const e of events) {
		if (JSON.stringify(e).includes(PROBE)) mirrored.push(e.type);
	}
	const counts = {};
	for (const t of mirrored) counts[t] = (counts[t] ?? 0) + 1;
	console.info(`[final] event types containing probe text: ${JSON.stringify(counts)}`);
	console.info('PROBE-DONE');
} finally {
	host.stop();
}
