#!/usr/bin/env node
/**
 * Real Bridge SkillSlash → Composer Gate queue repro.
 *
 * Spawns fast-cli bridge, runs /repro-ping (project skill), feeds every Bridge
 * event through session-view applyBridgeEvent + composerGate (same as Fast).
 *
 * Verdict:
 *   BUG  — skill content seen while gate.runState==='running', and either
 *          turn_finished never arrives within SETTLE_BUDGET_MS, OR a follow-up
 *          command would enqueue (canEnqueue && !canSubmitNow) after content.
 *   PASS — turn_finished arrives and gate is idle before follow-up.
 *
 * Usage:
 *   WORKDIR=… SETTLE_BUDGET_MS=30000 node repro-skillslash-queue.mjs
 */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {currentEngineCli, currentEngineDir} from '../../../../scripts/current-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Prefer built session-view; fall back to tsx-transpiled path via dynamic import.
async function loadSessionView() {
	const built = join(__dirname, '../../../packages/core/session-view/dist/index.js');
	if (existsSync(built)) {
		return import(built);
	}
	const src = join(__dirname, '../../../packages/core/session-view/src/index.ts');
	// tsx register if available
	try {
		await import('tsx/esm');
	} catch {
		/* ignore */
	}
	return import(src);
}

const AGENT_HOME = currentEngineDir();
const AGENT_CLI = currentEngineCli();
const SETTLE_BUDGET_MS = Number(process.env.SETTLE_BUDGET_MS ?? 45_000);
const READY_BUDGET_MS = Number(process.env.READY_BUDGET_MS ?? 90_000);
const MODEL = process.env.FAST_MODEL ?? '';

if (!AGENT_CLI || !existsSync(AGENT_CLI)) {
	console.error(`fast-cli not found: ${AGENT_CLI ?? '(none)'} — pnpm fetch-engine`);
	process.exit(1);
}

const workdir = process.env.WORKDIR ?? mkdtempSync(join(tmpdir(), 'ssl-queue-repro-'));
const skillDir = join(workdir, '.agents', 'skills', 'repro-ping');
mkdirSync(skillDir, {recursive: true});
writeFileSync(
	join(skillDir, 'SKILL.md'),
	`---
name: repro-ping
description: Minimal skill for SkillSlash queue repro — finishes without questions
---
Reply with exactly the single word PONG and nothing else. Do not ask the user any questions.
`
);

const tracePath = join(
	process.env.TRACE_DIR ?? mkdtempSync(join(tmpdir(), 'ssl-queue-trace-')),
	`skillslash-queue-${Date.now()}.jsonl`
);

/** @type {Array<Record<string, unknown>>} */
const events = [];
let sessionId = '';

function log(line) {
	const row = {t: Date.now(), ...line};
	events.push(row);
	process.stderr.write(`[ssl-repro] ${JSON.stringify(row)}\n`);
}

function writeTrace() {
	writeFileSync(tracePath, events.map(e => JSON.stringify(e)).join('\n') + '\n');
	process.stderr.write(`[ssl-repro] trace: ${tracePath}\n`);
}

function send(proc, obj) {
	log({dir: 'in', ...obj});
	proc.stdin.write(JSON.stringify(obj) + '\n');
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
		}, 40);
	});
}

async function main() {
	const {applyBridgeEvent, createTranscriptState, composerGate} = await loadSessionView();

	log({
		phase: 'start',
		AGENT_CLI,
		workdir,
		SETTLE_BUDGET_MS,
		MODEL: MODEL || '(default)',
		jarHint: AGENT_HOME ? join(AGENT_HOME, 'lib/ai.fastllm.agent-cli-0.2.0-SNAPSHOT.jar') : undefined
	});

	// Isolate RuntimeDb so a live Fast engine cannot block us on ~/.fast/server locks.
	const runtimeRoot =
		process.env.FAST_RUNTIME_ROOT ?? mkdtempSync(join(tmpdir(), 'ssl-runtime-'));
	mkdirSync(runtimeRoot, {recursive: true});
	const javaOpts = [
		process.env.JAVA_OPTS ?? '',
		`-Dfast.runtime.root=${runtimeRoot}`,
		'-Dfast.skills.projectTrusted=true'
	]
		.filter(Boolean)
		.join(' ');

	const proc = spawn(
		'/bin/sh',
		[AGENT_CLI, 'engine', '--mode', 'bridge', '--transport', 'stdio', '--new'],
		{
			cwd: workdir,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: {
				...process.env,
				JAVA_OPTS: javaOpts,
				'fast.skills.projectTrusted': 'true',
				FAST_SKILLS_PROJECT_TRUSTED: 'true'
			}
		}
	);

	let transcript = createTranscriptState();
	/** @type {Array<{t:number, type:string, runState:string, canEnqueue:boolean, canSubmitNow:boolean, activeRunId?:string, streaming:number}>} */
	const gateTimeline = [];

	function snapshotGate(reason) {
		const gate = composerGate(transcript, true);
		const streaming = transcript.entries.filter(e => e.status === 'streaming').length;
		const snap = {
			t: Date.now(),
			reason,
			runState: gate.runState,
			canEnqueue: gate.canEnqueue,
			canSubmitNow: gate.canSubmitNow,
			activeRunId: transcript.activeRunId,
			streaming
		};
		gateTimeline.push(snap);
		log({phase: 'gate', ...snap});
		return gate;
	}

	const rlOut = createInterface({input: proc.stdout});
	const rlErr = createInterface({input: proc.stderr});

	rlOut.on('line', line => {
		let obj;
		try {
			obj = JSON.parse(line);
		} catch {
			log({dir: 'out-raw', line: line.slice(0, 400)});
			return;
		}
		log({dir: 'out', type: obj.type, turnId: obj.turnId, clientMessageId: obj.clientMessageId, success: obj.success, reason: obj.reason, text: typeof obj.text === 'string' ? obj.text.slice(0, 80) : undefined, name: obj.name, status: obj.status, message: typeof obj.message === 'string' ? obj.message.slice(0, 120) : undefined});
		if (obj.type === 'ready') {
			sessionId = String(obj.sessionId ?? '');
		}
		try {
			transcript = applyBridgeEvent(transcript, obj);
			snapshotGate(`event:${obj.type}`);
		} catch (err) {
			log({phase: 'apply_error', err: String(err?.message || err), type: obj.type});
		}
	});
	rlErr.on('line', line => {
		log({dir: 'err', line: line.slice(0, 500)});
	});

	proc.on('exit', (code, signal) => log({phase: 'exit', code, signal}));

	try {
		await waitFor(e => e.dir === 'out' && e.type === 'ready', 'ready', READY_BUDGET_MS);
		if (!sessionId) throw new Error('ready without sessionId');
		log({phase: 'ready', sessionId});
		snapshotGate('after-ready');

		// Force project skill trust via Java prop on next... already in env; also send skills list
		send(proc, {type: 'command', name: 'skills', args: '', sessionId});

		await new Promise(r => setTimeout(r, 800));

		send(proc, {
			type: 'command',
			name: 'repro-ping',
			args: '',
			sessionId
		});

		// Content "looks done": assistant_delta / final_answer / agent_call_finished
		await waitFor(
			e =>
				e.dir === 'out' &&
				(e.type === 'assistant_delta' ||
					e.type === 'final_answer' ||
					e.type === 'agent_call_finished' ||
					e.type === 'turn_finished' ||
					e.type === 'turn_cancelled' ||
					(e.type === 'command_result' && String(e.message || '').includes('Unknown'))),
			'skill progress or terminal',
			SETTLE_BUDGET_MS
		);

		const contentAt = Date.now();
		const gateAtContent = snapshotGate('content-or-terminal');

		// Probe continuously: Fast queues while gate is running after content.
		let settled = events.some(
			e => e.dir === 'out' && (e.type === 'turn_finished' || e.type === 'turn_cancelled')
		);
		const deadline = contentAt + SETTLE_BUDGET_MS;
		let maxStuckRunningMs = 0;
		let wouldEnqueueDuringWait = false;
		while (!settled && Date.now() < deadline) {
			await new Promise(r => setTimeout(r, 100));
			const g = snapshotGate('probe');
			const stuck = Date.now() - contentAt;
			if (g.runState === 'running') {
				maxStuckRunningMs = stuck;
				if (g.canEnqueue && !g.canSubmitNow) wouldEnqueueDuringWait = true;
			}
			settled = events.some(
				e => e.dir === 'out' && (e.type === 'turn_finished' || e.type === 'turn_cancelled')
			);
		}

		const gateAfterWait = snapshotGate('after-settle-wait');
		const turnFinished = events.find(e => e.dir === 'out' && e.type === 'turn_finished');
		const turnCancelled = events.find(e => e.dir === 'out' && e.type === 'turn_cancelled');
		const settleLatencyMs = turnFinished
			? turnFinished.t - contentAt
			: turnCancelled
				? turnCancelled.t - contentAt
				: null;

		// Follow-up skill — what Fast would do with canEnqueue
		const wouldEnqueue =
			wouldEnqueueDuringWait ||
			(gateAfterWait.canEnqueue && !gateAfterWait.canSubmitNow);
		send(proc, {
			type: 'command',
			name: 'repro-ping',
			args: 'second',
			sessionId
		});
		await new Promise(r => setTimeout(r, 1500));
		const rejected = events.some(
			e => e.dir === 'out' && e.type === 'input_rejected' && e.t >= contentAt
		);

		const types = events.filter(e => e.dir === 'out').map(e => e.type);
		const verdict = {
			phase: 'verdict',
			settled: Boolean(turnFinished || turnCancelled),
			terminal: turnFinished ? 'turn_finished' : turnCancelled ? 'turn_cancelled' : 'none',
			settleLatencyMs,
			maxStuckRunningMs,
			wouldEnqueueDuringWait,
			gateAtContent,
			gateAfterWait,
			wouldEnqueue,
			rejected,
			bug:
				(!turnFinished && !turnCancelled) ||
				wouldEnqueueDuringWait ||
				(settleLatencyMs != null && settleLatencyMs > 3000) ||
				maxStuckRunningMs > 3000,
			outTypes: types
		};
		log(verdict);
		writeTrace();

		proc.kill('SIGTERM');
		await new Promise(r => setTimeout(r, 500));

		if (verdict.bug) {
			console.error(
				`FAIL: SkillSlash queue bug reproduced. terminal=${verdict.terminal} settleLatencyMs=${settleLatencyMs} wouldEnqueue=${wouldEnqueue} rejected=${rejected}`
			);
			process.exit(2);
		}
		console.log(
			`PASS: settled=${verdict.terminal} settleLatencyMs=${settleLatencyMs} gate=${gateAfterWait.runState} wouldEnqueue=${wouldEnqueue}`
		);
		process.exit(0);
	} catch (err) {
		log({phase: 'error', err: String(err?.message || err)});
		writeTrace();
		try {
			proc.kill('SIGKILL');
		} catch {
			/* ignore */
		}
		console.error(`FAIL: ${err?.message || err}`);
		process.exit(1);
	}
}

main();
