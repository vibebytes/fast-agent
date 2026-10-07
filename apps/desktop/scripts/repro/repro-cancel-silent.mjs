#!/usr/bin/env node
/**
 * Real-engine「静默期停止」E2E harness — measures CancelAssociated during a silent busy turn.
 *
 * The mock timing LLM (FAST_E2E_TIMING_LLM=mock) Thread.sleep()s the whole window before its
 * first byte — zero deltas, zero traffic — the exact engine-side shape of a silent tool call.
 *
 * Flow:
 *   1. spawn fast-cli engine --mode bridge --transport stdio --new (FAST_E2E_TIMING_LLM_DELAY_MS=70000)
 *   2. turn1 starts (turn_started fires while the LLM sleep is still holding the silence)
 *   3. ~8s into the silence send CancelAssociated (the wire command the desktop Stop sends)
 *   4. measure dispatch → command_result(ack) → run_cancelled/turn_cancelled (terminal)
 *
 * RESULT JSON goes to stderr; full NDJSON trace to $TRACE_DIR.
 *   node scripts/repro/repro-cancel-silent.mjs
 */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtempSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {currentEngineCli} from '../../../../scripts/current-engine.mjs';

const AGENT_CLI = currentEngineCli();
const WORKDIR = process.env.WORKDIR ?? mkdtempSync(join(tmpdir(), 'cancel-silent-e2e-'));
const ISOLATE_HOME = process.env.FAST_E2E_HOME ?? mkdtempSync(join(tmpdir(), 'cancel-silent-home-'));
const DELAY_MS = Number(process.env.FAST_E2E_TIMING_LLM_DELAY_MS ?? 70_000);
const SILENCE_BEFORE_CANCEL_MS = Number(process.env.SILENCE_BEFORE_CANCEL_MS ?? 8_000);
const READY_BUDGET_MS = Number(process.env.READY_BUDGET_MS ?? 90_000);
const STARTED_BUDGET_MS = Number(process.env.STARTED_BUDGET_MS ?? 30_000);
const ACK_BUDGET_MS = Number(process.env.ACK_BUDGET_MS ?? 30_000);
const TERMINAL_BUDGET_MS = Number(process.env.TERMINAL_BUDGET_MS ?? 120_000);
const QUIESCE_MS = Number(process.env.QUIESCE_MS ?? 2_000);
const rndPort = () => String(31000 + Math.floor(Math.random() * 20000));
const RT_ROOT = process.env.FAST_E2E_RUNTIME_ROOT ?? mkdtempSync(join(tmpdir(), 'cancel-silent-rt-'));
const KERNEL_PORT = process.env.FAST_E2E_AGENT_PORT ?? rndPort();
const HTTP_PORT = process.env.FAST_E2E_HTTP_PORT ?? rndPort();
const JOIN_PORT = process.env.FAST_E2E_JOIN_PORT ?? rndPort();
const WSS_PORT = process.env.FAST_E2E_WSS_PORT ?? rndPort();
const WS_PORT = process.env.FAST_E2E_WS_PORT ?? rndPort();

if (!AGENT_CLI || !existsSync(AGENT_CLI)) {
	console.error(`fast-cli not found: ${AGENT_CLI ?? '(none)'} — pnpm fetch-engine`);
	process.exit(1);
}

let abortReason = '';

const tracePath = join(
	process.env.TRACE_DIR ?? mkdtempSync(join(tmpdir(), 'cancel-silent-trace-')),
	`cancel-silent-${Date.now()}.jsonl`
);
mkdirSync(dirname(tracePath), {recursive: true});

/** @type {Array<Record<string, unknown>>} */
const events = [];
let sessionId = '';

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
function waitFor(pred, label, timeoutMs) {
	return new Promise(resolve => {
		const start = Date.now();
		const timer = setInterval(() => {
			if (abortReason) {
				clearInterval(timer);
				resolve(null);
				return;
			}
			const hit = events.find(pred);
			if (hit) {
				clearInterval(timer);
				resolve(hit);
			} else if (Date.now() - start > timeoutMs) {
				clearInterval(timer);
				log({phase: 'wait_timeout', label, timeoutMs});
				resolve(null);
			}
		}, 50);
	});
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
	log({phase: 'start', AGENT_CLI, WORKDIR, ISOLATE_HOME, DELAY_MS, SILENCE_BEFORE_CANCEL_MS, RT_ROOT, ports: {KERNEL_PORT, HTTP_PORT, JOIN_PORT, WSS_PORT, WS_PORT}});
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
				FAST_E2E_TIMING_LLM: 'mock',
				FAST_E2E_TIMING_LLM_DELAY_MS: String(DELAY_MS),
				FAST_RUNTIME_ROOT: RT_ROOT,
				FAST_AGENT_PORT: KERNEL_PORT,
				ARTERY_PORT: KERNEL_PORT,
				FAST_AGENT_HTTP_PORT: HTTP_PORT,
				FAST_JOIN_PORT: JOIN_PORT,
				FAST_BRIDGE_WSS_PORT: WSS_PORT,
				FAST_BRIDGE_WS_PORT: WS_PORT
			}
		}
	);
	createInterface({input: proc.stdout}).on('line', line => {
		let obj;
		try {
			obj = JSON.parse(line);
		} catch {
			log({dir: 'out-raw', line: String(line).slice(0, 500)});
			return;
		}
		log({dir: 'out', ...obj});
		if (obj?.type === 'ready') sessionId = String(obj.sessionId ?? '');
	});
	createInterface({input: proc.stderr}).on('line', line => {
		const text = String(line).slice(0, 800);
		log({dir: 'err', line: text});
		if (text.includes('ENGINE_BUSY')) {
			abortReason = `ENGINE_BUSY: ${text.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 200)}`;
		}
	});
	proc.on('exit', (code, signal) => log({phase: 'exit', code, signal}));

	const result = {
		phase: 'RESULT',
		delayMs: DELAY_MS,
		cancelAtSilenceMs: null,
		dispatchToAckMs: null,
		ackStatus: null,
		dispatchToTerminalMs: null,
		ackToTerminalMs: null,
		terminalType: null,
		contentEventsAfterCancel: 0,
		turnFinishedAfterCancel: false
	};
	try {
		const ready = await waitFor(e => e.dir === 'out' && e.type === 'ready', 'ready', READY_BUDGET_MS);
		if (!ready || !sessionId) throw new Error(abortReason || 'no ready/sessionId');
		log({phase: 'ready', sessionId});

		send(proc, {
			type: 'SubmitUserMessage',
			sessionId,
			clientMessageId: `cid-1-${Date.now()}`,
			text: '请从1数到200，每个数字单独一行。直接开始，不要解释。'
		});
		const started = await waitFor(
			e => e.dir === 'out' && ['turn_started', 'input_accepted'].includes(String(e.type)),
			'turn1 started',
			STARTED_BUDGET_MS
		);
		if (!started) throw new Error('turn1 never started');
		log({phase: 'turn1_started', type: started.type, silentWindowMsLeft: DELAY_MS});

		await sleep(SILENCE_BEFORE_CANCEL_MS);
		result.cancelAtSilenceMs = SILENCE_BEFORE_CANCEL_MS;
		const tDispatch = Date.now();
		send(proc, {type: 'CancelAssociated', sessionId, reason: 'stop'});

		const ack = await waitFor(
			e => e.dir === 'out' && e.type === 'command_result' && e.name === 'CancelAssociated',
			'cancel ack',
			ACK_BUDGET_MS
		);
		result.ackStatus = ack ? String(ack.status ?? '') : 'TIMEOUT';
		if (ack) {
			result.dispatchToAckMs = Number(ack.t) - tDispatch;
			log({phase: 'cancel_acked', status: ack.status, dispatchToAckMs: result.dispatchToAckMs});
		}

		const terminal = await waitFor(
			e =>
				e.dir === 'out' &&
				['run_cancelled', 'turn_cancelled'].includes(String(e.type)) &&
				Number(e.t) >= tDispatch,
			'terminal event',
			TERMINAL_BUDGET_MS
		);
		if (terminal) {
			result.dispatchToTerminalMs = Number(terminal.t) - tDispatch;
			result.ackToTerminalMs = ack ? Number(terminal.t) - Number(ack.t) : null;
			result.terminalType = String(terminal.type);
			log({phase: 'terminal', ...result});
		}

		await sleep(QUIESCE_MS);
		const after = events.filter(e => e.dir === 'out' && Number(e.t) >= tDispatch);
		result.contentEventsAfterCancel = after.filter(e =>
			['assistant_delta', 'reasoning_delta', 'tool_started', 'tool_finished'].includes(String(e.type))
		).length;
		result.turnFinishedAfterCancel = after.some(e => e.type === 'turn_finished');
	} catch (err) {
		log({phase: 'setup_failure', error: String(err)});
		process.exitCode = 1;
	} finally {
		proc.kill('SIGKILL');
		writeTrace();
		process.stderr.write(`[repro] ${JSON.stringify(result)}\n`);
	}
}

await main();
