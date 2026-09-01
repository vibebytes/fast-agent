#!/usr/bin/env node
/**
 * Real-engine「插话」(InterruptWithMessage) E2E harness — frontend wire contract,
 * actual JVM engine over NDJSON stdio (no mocks).
 *
 * Flow:
 *   1. spawn fast-cli engine --mode bridge --transport stdio --new
 *   2. turn1: long streaming prompt (keeps LLM busy)
 *   3. busy submit → expect command_result(status=queued) + follow_up_changed(items=[itemId])
 *   4. InterruptWithMessage{itemId} → expect accepted("interrupt_started"),
 *      turn1 cancelled/settled, follow_up_changed(items=[]), then turn2
 *      (clientMessageId=cid3) runs to final_answer/turn_finished(success)
 *
 * Usage:
 *   node scripts/repro/repro-interrupt.mjs
 *   FAST_MODEL=… WORKDIR=… node scripts/repro/repro-interrupt.mjs
 *
 * Exit 0 = PASS. Exit 2 = contract violation / stuck. Exit 1 = setup failure.
 */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtempSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {currentEngineCli} from '../../../../scripts/current-engine.mjs';

const AGENT_CLI = currentEngineCli();
const WORKDIR = process.env.WORKDIR ?? mkdtempSync(join(tmpdir(), 'interrupt-e2e-'));
const ISOLATE_HOME = process.env.FAST_E2E_HOME ?? mkdtempSync(join(tmpdir(), 'interrupt-home-'));
const TIMING_LLM = process.env.FAST_E2E_TIMING_LLM ?? 'mock';
const TIMING_LLM_DELAY_MS = process.env.FAST_E2E_TIMING_LLM_DELAY_MS ?? '4000';
const ARTERY_PORT = process.env.ARTERY_PORT ?? String(21000 + Math.floor(Math.random() * 20000));
const TURN1_PROGRESS_BUDGET_MS = Number(process.env.TURN1_PROGRESS_BUDGET_MS ?? 60_000);
const QUEUE_BUDGET_MS = Number(process.env.QUEUE_BUDGET_MS ?? 30_000);
const CANCEL_SETTLE_BUDGET_MS = Number(process.env.CANCEL_SETTLE_BUDGET_MS ?? 30_000);
const TURN2_START_BUDGET_MS = Number(process.env.TURN2_START_BUDGET_MS ?? 25_000);
const TURN2_FINISH_BUDGET_MS = Number(process.env.TURN2_FINISH_BUDGET_MS ?? 120_000);
const MODEL = process.env.FAST_MODEL ?? '';
const FIRST_PROMPT =
	process.env.FIRST_PROMPT ??
	'请从1数到200，每个数字单独一行，并在每个数字后面加一个四字成语。直接开始，不要解释。';
const QUEUED_PROMPT = process.env.QUEUED_PROMPT ?? '（排队消息）总结一下刚才的内容';
const INTERRUPT_PROMPT = process.env.INTERRUPT_PROMPT ?? '（插话）停下当前任务，只回复：收到插话';

if (!AGENT_CLI || !existsSync(AGENT_CLI)) {
	console.error(`fast-cli not found: ${AGENT_CLI ?? '(none)'}`);
	console.error('pnpm fetch-engine');
	process.exit(1);
}

const tracePath = join(
	process.env.TRACE_DIR ?? mkdtempSync(join(tmpdir(), 'interrupt-trace-')),
	`interrupt-${Date.now()}.jsonl`
);
mkdirSync(dirname(tracePath), {recursive: true});

/** @type {Array<Record<string, unknown>>} */
const events = [];
let sessionId = '';
let lastRunId = '';

function log(line) {
	const row = {t: Date.now(), ...line};
	events.push(row);
	process.stderr.write(`[repro] ${JSON.stringify(row)}\n`);
}

function writeTrace() {
	writeFileSync(tracePath, events.map(e => JSON.stringify(e)).join('\n') + '\n');
	process.stderr.write(`[repro] trace written: ${tracePath}\n`);
}

function send(proc, obj) {
	log({dir: 'in', ...obj});
	proc.stdin.write(JSON.stringify(obj) + '\n');
}

function eventType(obj) {
	return typeof obj?.type === 'string' ? obj.type : '';
}

function waitFor(pred, label, timeoutMs) {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const timer = setInterval(() => {
			const hit = events.find(pred);
			if (hit) {
				clearInterval(timer);
				resolve(hit);
				return;
			}
			if (Date.now() - start > timeoutMs) {
				clearInterval(timer);
				reject(new Error(`timeout waiting for ${label} (${timeoutMs}ms)`));
			}
		}, 50);
	});
}

function outEventsAfter(idx) {
	return events.slice(idx).filter(e => e.dir === 'out');
}

function fail(message) {
	writeTrace();
	console.error(`FAIL: ${message}`);
	process.exit(2);
}

async function main() {
	log({phase: 'start', AGENT_CLI, WORKDIR, ISOLATE_HOME, TIMING_LLM, TIMING_LLM_DELAY_MS});
	const proc = spawn(
		'/bin/sh',
		[AGENT_CLI, `-Duser.home=${ISOLATE_HOME}`, 'engine', '--mode', 'bridge', '--transport', 'stdio', '--new'],
		{
			cwd: WORKDIR,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: {
				PATH: process.env.PATH,
				HOME: ISOLATE_HOME,
				TMPDIR: process.env.TMPDIR,
				LANG: process.env.LANG,
				FAST_E2E_TIMING_LLM: TIMING_LLM,
				FAST_E2E_TIMING_LLM_DELAY_MS: TIMING_LLM_DELAY_MS,
				ARTERY_PORT,
				...(MODEL ? {FAST_MODEL: MODEL} : {})
			}
		}
	);

	const rlOut = createInterface({input: proc.stdout});
	rlOut.on('line', line => {
		let obj;
		try {
			obj = JSON.parse(line);
		} catch {
			log({dir: 'out-raw', line: String(line).slice(0, 500)});
			return;
		}
		log({dir: 'out', ...obj});
		if (eventType(obj) === 'ready') sessionId = String(obj.sessionId ?? '');
		if (eventType(obj) === 'input_accepted' && obj.turnId) lastRunId = String(obj.turnId);
		if (eventType(obj) === 'turn_started' && !lastRunId) lastRunId = String(obj.turnId);
	});
	createInterface({input: proc.stderr}).on('line', line => {
		log({dir: 'err', line: String(line).slice(0, 800)});
	});
	proc.on('exit', (code, signal) => log({phase: 'exit', code, signal}));

	try {
		await waitFor(e => e.dir === 'out' && e.type === 'ready', 'ready', 60_000);
		if (!sessionId) throw new Error('ready without sessionId');
		log({phase: 'ready', sessionId});

		// --- Turn 1: keep the engine busy ---
		const cid1 = `cid-1-${Date.now()}`;
		const submit1 = {type: 'SubmitUserMessage', sessionId, clientMessageId: cid1, text: FIRST_PROMPT};
		if (MODEL) submit1.useModel = MODEL;
		send(proc, submit1);

		await waitFor(
			e =>
				e.dir === 'out' &&
				['assistant_delta', 'reasoning_delta', 'tool_started'].includes(String(e.type)),
			'turn1 streaming progress',
			TURN1_PROGRESS_BUDGET_MS
		);
		log({phase: 'turn1_streaming', runId: lastRunId});

		// --- Busy submit: must queue as follow-up ---
		const cid2 = `cid-2-${Date.now()}`;
		send(proc, {type: 'SubmitUserMessage', sessionId, clientMessageId: cid2, text: QUEUED_PROMPT});

		const queuedMark = await waitFor(
			e => e.dir === 'out' && e.type === 'command_result' && e.status === 'queued',
			'busy submit queued',
			QUEUE_BUDGET_MS
		);
		const fuChanged = [...events]
			.reverse()
			.find(e => e.dir === 'out' && e.type === 'follow_up_changed');
		let itemId = '';
		try {
			const items = JSON.parse(String(fuChanged?.itemsJson ?? '[]'));
			itemId = String(items[items.length - 1]?.id ?? '');
		} catch {}
		if (!itemId) itemId = String(queuedMark.message ?? '').replace(/^followUpId=/, '');
		if (!itemId) fail(`no follow-up itemId (message=${queuedMark.message})`);
		log({phase: 'queued', itemId});

		// --- 插话: interrupt with the queued item ---
		const cid3 = `cid-3-${Date.now()}`;
		const tInterrupt = Date.now();
		send(proc, {
			type: 'InterruptWithMessage',
			sessionId,
			text: INTERRUPT_PROMPT,
			clientMessageId: cid3,
			itemId
		});

		const acked = await waitFor(
			e =>
				e.dir === 'out' &&
				e.type === 'command_result' &&
				e.name === 'InterruptWithMessage' &&
				e.status === 'accepted',
			'interrupt accepted',
			CANCEL_SETTLE_BUDGET_MS
		);
		log({phase: 'interrupt_accepted', message: acked.message});

		const settled = await waitFor(
			e =>
				e.dir === 'out' &&
				['run_cancelled', 'turn_cancelled'].includes(String(e.type)) &&
				tInterrupt <= Number(e.t),
			'turn1 cancellation event',
			CANCEL_SETTLE_BUDGET_MS
		);
		log({phase: 'turn1_cancelled', type: settled.type});

		const drained = await waitFor(
			e => {
				if (e.dir !== 'out' || e.type !== 'follow_up_changed' || Number(e.t) < tInterrupt) return false;
				try {
					return JSON.parse(String(e.itemsJson ?? '[]')).length === 0;
				} catch {
					return false;
				}
			},
			'follow_up drained',
			CANCEL_SETTLE_BUDGET_MS
		);
		log({phase: 'queue_drained'});

		// --- Turn 2: the interrupt turn (real engine acks via turn_started, not input_accepted) ---
		const started = await waitFor(
			e =>
				e.dir === 'out' &&
				e.type === 'turn_started' &&
				String(e.clientMessageId ?? '') === cid3,
			'turn2 turn_started',
			TURN2_START_BUDGET_MS
		);
		const latencyStartMs = Number(started.t) - tInterrupt;
		log({phase: 'turn2_started', latencyFromInterruptMs: latencyStartMs});

		const finished = await waitFor(
			e => e.dir === 'out' && e.type === 'turn_finished',
			'turn2 turn_finished',
			TURN2_FINISH_BUDGET_MS
		);
		if (finished.success === false) fail('turn2 finished unsuccessful');
		const answer = [...events].reverse().find(e => e.dir === 'out' && e.type === 'final_answer');
		log({
			phase: 'verdict',
			latencyFromInterruptMs: latencyStartMs,
			finalAnswerPreview: String(answer?.text ?? '').slice(0, 200),
			drainedAt: Number(drained.t) - tInterrupt
		});
		writeTrace();
		console.log(`PASS: 插话 round-trip OK (cancel→turn2 start ${latencyStartMs}ms)`);
		proc.kill('SIGTERM');
		process.exit(0);
	} catch (err) {
		const types = outEventsAfter(0).map(e => String(e.type));
		fail(`${err?.message ?? err} | tail=${types.slice(-40).join(',')}`);
	}
}

main();
