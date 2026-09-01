#!/usr/bin/env node
/**
 * Real Bridge cancel→resubmit repro harness.
 *
 * Experiments (EXPERIMENT=A|B|C, default A):
 *   A: cancel mid-run → immediate resubmit (expect stuck / fail)
 *   B: cancel → WAIT POST_CANCEL_DELAY_MS (default 8000) → resubmit
 *   C: single turn, no cancel (sanity: LLM should progress)
 *
 * Usage:
 *   WORKDIR=… SECOND_TURN_BUDGET_MS=20000 EXPERIMENT=A node …
 *
 * Exit 0 = progress OK. Exit 2 = stuck / bad cancel settlement. Exit 1 = setup/fail.
 */
import {spawn, execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtempSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {currentEngineCli} from '../../../../scripts/current-engine.mjs';

const AGENT_CLI = currentEngineCli();
const WORKDIR = process.env.WORKDIR ?? mkdtempSync(join(tmpdir(), 'cancel-repro-'));
const SECOND_TURN_BUDGET_MS = Number(process.env.SECOND_TURN_BUDGET_MS ?? 45_000);
const CANCEL_AFTER_MS = Number(process.env.CANCEL_AFTER_MS ?? 4_000);
const POST_CANCEL_DELAY_MS = Number(process.env.POST_CANCEL_DELAY_MS ?? 8_000);
const STUCK_PROBE_AFTER_MS = Number(process.env.STUCK_PROBE_AFTER_MS ?? 12_000);
const EXPERIMENT = (process.env.EXPERIMENT ?? 'A').toUpperCase();
const MODEL = process.env.FAST_MODEL ?? '';

if (!AGENT_CLI || !existsSync(AGENT_CLI)) {
	console.error(`fast-cli not found: ${AGENT_CLI ?? '(none)'} — pnpm fetch-engine`);
	process.exit(1);
}
if (!['A', 'B', 'C'].includes(EXPERIMENT)) {
	console.error(`EXPERIMENT must be A|B|C, got ${EXPERIMENT}`);
	process.exit(1);
}

const tracePath = join(
	process.env.TRACE_DIR ?? mkdtempSync(join(tmpdir(), 'cancel-trace-')),
	`cancel-resubmit-${EXPERIMENT}-${Date.now()}.jsonl`
);
mkdirSync(join(tracePath, '..'), {recursive: true});

/** @type {Array<Record<string, unknown>>} */
const events = [];
let sessionId = '';
let lastRunId = '';
let adminUrl = '';
let sawReady = false;

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
	const line = JSON.stringify(obj);
	log({dir: 'in', ...obj});
	proc.stdin.write(line + '\n');
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

/** Redact secrets from admin JSON snippets before logging. */
function redactAdminBody(text) {
	if (!text) return text;
	return text
		.replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"<redacted>"')
		.replace(/"apiKey"\s*:\s*"[^"]*"/gi, '"apiKey":"<redacted>"')
		.replace(/"api_key"\s*:\s*"[^"]*"/gi, '"api_key":"<redacted>"')
		.replace(/"authorization"\s*:\s*"[^"]*"/gi, '"authorization":"<redacted>"')
		.replace(/"secret"\s*:\s*"[^"]*"/gi, '"secret":"<redacted>"')
		.replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"<redacted>"');
}

function curlGet(url, maxBytes = 8000) {
	try {
		const out = execFileSync(
			'curl',
			['-sS', '-m', '3', '-H', 'Accept: application/json, */*;q=0.1', url],
			{encoding: 'utf8', maxBuffer: 2 * 1024 * 1024}
		);
		const truncated = out.length > maxBytes ? out.slice(0, maxBytes) + '…[truncated]' : out;
		return {ok: true, body: redactAdminBody(truncated)};
	} catch (err) {
		const msg = err?.stderr?.toString?.() || String(err?.message || err);
		return {ok: false, body: redactAdminBody(msg).slice(0, 500)};
	}
}

function probeAdmin(label) {
	if (!adminUrl) {
		log({phase: 'admin_probe_skip', label, reason: 'no adminUrl yet'});
		return;
	}
	// engine_status admin_ready message is like http://127.0.0.1:PORT/admin
	const adminBase = adminUrl.replace(/\/$/, '');
	const origin = adminBase.replace(/\/admin$/, '');
	const sid = sessionId;
	const runId = lastRunId;
	const paths = [
		'/admin',
		'/admin/api/v1/system/overview',
		'/admin/api/v1/runs/status?limit=20',
		'/admin/api/v1/sessions?limit=20',
		sid ? `/admin/api/v1/sessions/${encodeURIComponent(sid)}` : null,
		sid ? `/admin/api/v1/sessions/${encodeURIComponent(sid)}/runs` : null,
		sid ? `/admin/api/v1/sessions/${encodeURIComponent(sid)}/messages` : null,
		sid ? `/admin/api/v1/traces?sessionId=${encodeURIComponent(sid)}&limit=20` : null,
		runId ? `/admin/api/v1/runs/${encodeURIComponent(runId)}` : null,
		runId ? `/admin/api/v1/runs/${encodeURIComponent(runId)}/steps` : null,
		'/admin/api/v1/llm/requests?limit=10',
		'/admin/api/v1/llm/providers/health'
	].filter(Boolean);

	const results = [];
	for (const p of paths) {
		const url = p.startsWith('http') ? p : `${origin}${p}`;
		const r = curlGet(url);
		results.push({path: p, ok: r.ok, snippet: r.body.slice(0, 1500)});
		log({phase: 'admin_probe', label, path: p, url, ok: r.ok, snippet: r.body.slice(0, 1200)});
	}
	console.error(`\n=== ADMIN PROBE (${label}) origin=${origin} admin=${adminBase} session=${sid} run=${runId} ===`);
	for (const r of results) {
		console.error(`--- ${r.path} ok=${r.ok} ---`);
		console.error(r.snippet.slice(0, 1000));
	}
	console.error(`=== END ADMIN PROBE ===\n`);
}

const progressTypes = new Set([
	'assistant_delta',
	'reasoning_delta',
	'tool_started',
	'final_answer',
	'turn_finished',
	'turn_cancelled',
	'input_rejected',
	'error',
	'run_failed'
]);

async function waitForProgress(afterIdx, budgetMs, label) {
	const deadline = Date.now() + budgetMs;
	const probeAt = Date.now() + STUCK_PROBE_AFTER_MS;
	let probed = false;
	/** @type {string | null} */
	let progress = null;
	while (Date.now() < deadline) {
		const slice = events.slice(afterIdx);
		const hit = slice.find(e => e.dir === 'out' && progressTypes.has(String(e.type)));
		if (hit) {
			progress = String(hit.type);
			break;
		}
		if (!probed && Date.now() >= probeAt) {
			probed = true;
			probeAdmin(`${label}_after_${STUCK_PROBE_AFTER_MS}ms_no_progress`);
		}
		await new Promise(r => setTimeout(r, 200));
	}
	if (!progress && !probed) {
		probeAdmin(`${label}_budget_exhausted`);
	} else if (!progress && probed) {
		probeAdmin(`${label}_still_stuck_at_budget`);
	}
	return progress;
}

async function main() {
	log({
		phase: 'start',
		EXPERIMENT,
		AGENT_CLI,
		WORKDIR,
		SECOND_TURN_BUDGET_MS,
		CANCEL_AFTER_MS,
		POST_CANCEL_DELAY_MS,
		MODEL: MODEL || '(default)'
	});

	const proc = spawn('/bin/sh', [AGENT_CLI, 'engine', '--mode', 'bridge', '--transport', 'stdio', '--new'], {
		cwd: WORKDIR,
		stdio: ['pipe', 'pipe', 'pipe'],
		env: process.env
	});

	const rlOut = createInterface({input: proc.stdout});
	const rlErr = createInterface({input: proc.stderr});

	rlOut.on('line', line => {
		let obj;
		try {
			obj = JSON.parse(line);
		} catch {
			log({dir: 'out-raw', line: line.slice(0, 500)});
			return;
		}
		log({dir: 'out', ...obj});
		const t = eventType(obj);
		if (t === 'engine_status') {
			process.stderr.write(
				`[repro] engine_status stage=${obj.stage} message=${String(obj.message ?? '').slice(0, 300)}\n`
			);
			if (obj.stage === 'admin_ready' && obj.message) {
				adminUrl = String(obj.message);
				log({phase: 'admin_url', adminUrl});
			}
			if (typeof obj.adminUrl === 'string' && obj.adminUrl) {
				adminUrl = obj.adminUrl;
				log({phase: 'admin_url', adminUrl});
			}
		}
		if (t === 'ready') {
			sawReady = true;
			sessionId = String(obj.sessionId ?? '');
			if (obj.adminUrl) adminUrl = String(obj.adminUrl);
		}
		if (t === 'input_accepted' && obj.turnId && obj.clientMessageId && obj.turnId !== obj.clientMessageId) {
			lastRunId = String(obj.turnId);
		}
		if (t === 'turn_started' && obj.turnId) {
			if (!lastRunId) lastRunId = String(obj.turnId);
		}
	});
	rlErr.on('line', line => {
		log({dir: 'err', line: line.slice(0, 800)});
	});

	proc.on('exit', (code, signal) => {
		log({phase: 'exit', code, signal});
	});

	try {
		await waitFor(e => e.dir === 'out' && e.type === 'ready', 'ready', 60_000);
		if (!sessionId) throw new Error('ready without sessionId');
		log({phase: 'ready', sessionId, adminUrl: adminUrl || '(pending)'});

		// --- Turn 1 ---
		const cid1 = `cid-1-${Date.now()}`;
		const submit1 = {
			type: 'SubmitUserMessage',
			sessionId,
			clientMessageId: cid1,
			text: process.env.FIRST_PROMPT ?? '列出当前目录文件，用 ls -la'
		};
		if (MODEL) submit1.useModel = MODEL;
		send(proc, submit1);

		await waitFor(
			e =>
				e.dir === 'out' &&
				(e.type === 'thinking_started' ||
					e.type === 'tool_started' ||
					e.type === 'assistant_delta' ||
					e.type === 'reasoning_delta'),
			'turn1 progress',
			60_000
		);

		if (EXPERIMENT === 'C') {
			const afterIdx = events.length;
			const progress = await waitForProgress(afterIdx - 20, SECOND_TURN_BUDGET_MS, 'expC_single_turn');
			// already saw progress to enter here; look for more definitive progress
			const slice = events.filter(e => e.dir === 'out');
			const types = slice.map(e => e.type);
			const good = slice.some(e =>
				['tool_started', 'assistant_delta', 'reasoning_delta', 'final_answer', 'turn_finished'].includes(
					String(e.type)
				)
			);
			log({phase: 'expC_verdict', progress, good, types: types.slice(-30)});
			writeTrace();
			if (!good) {
				console.error(`FAIL[C]: single turn no LLM progress within budget. types=${types.join(',')}`);
				proc.kill('SIGTERM');
				process.exit(2);
			}
			console.log(`PASS[C]: single turn progressed (saw tool/assistant/reasoning)`);
			proc.kill('SIGTERM');
			process.exit(0);
		}

		// Let tools start a bit (matches user cancelling mid-run).
		await new Promise(r => setTimeout(r, CANCEL_AFTER_MS));

		const runId = lastRunId || cid1;
		send(proc, {
			type: 'CancelRun',
			sessionId,
			runId,
			reason: 'repro-cancel'
		});

		await waitFor(e => e.dir === 'out' && e.type === 'turn_cancelled', 'turn_cancelled', 30_000);
		log({phase: 'turn1_cancelled', runId, EXPERIMENT});

		if (EXPERIMENT === 'B') {
			log({phase: 'post_cancel_wait', ms: POST_CANCEL_DELAY_MS});
			await new Promise(r => setTimeout(r, POST_CANCEL_DELAY_MS));
		}

		// --- Turn 2 ---
		const cid2 = `cid-2-${Date.now()}`;
		lastRunId = '';
		const afterCancelIdx = events.length;
		const submit2 = {
			type: 'SubmitUserMessage',
			sessionId,
			clientMessageId: cid2,
			text: process.env.SECOND_PROMPT ?? '继续'
		};
		if (MODEL) submit2.useModel = MODEL;
		send(proc, submit2);

		await waitFor(
			e =>
				e.dir === 'out' &&
				(e.type === 'turn_started' || e.type === 'input_accepted') &&
				(String(e.clientMessageId ?? '') === cid2 || String(e.turnId ?? '') === cid2),
			'turn2 started/accepted',
			15_000
		);

		// Prefer server turnId from input_accepted
		const accepted = [...events]
			.reverse()
			.find(e => e.dir === 'out' && e.type === 'input_accepted' && String(e.clientMessageId) === cid2);
		if (accepted?.turnId) lastRunId = String(accepted.turnId);

		const progress = await waitForProgress(afterCancelIdx, SECOND_TURN_BUDGET_MS, `exp${EXPERIMENT}_turn2`);

		const turn2Types = events
			.slice(afterCancelIdx)
			.filter(e => e.dir === 'out')
			.map(e => e.type);

		log({phase: 'turn2_verdict', EXPERIMENT, progress, turn2Types, lastRunId, adminUrl});

		if (!progress) {
			writeTrace();
			console.error(
				`FAIL[${EXPERIMENT}]: second turn stuck after turn_started (only saw: ${turn2Types.join(',') || 'nothing'}). ` +
					`This matches IDE "Thinking" hang.`
			);
			proc.kill('SIGTERM');
			process.exit(2);
		}

		if (progress === 'turn_cancelled') {
			writeTrace();
			console.error(`FAIL[${EXPERIMENT}]: second turn auto turn_cancelled (stale cancel settlement).`);
			proc.kill('SIGTERM');
			process.exit(2);
		}

		if (progress === 'input_rejected') {
			writeTrace();
			console.error(`FAIL[${EXPERIMENT}]: second turn input_rejected (gate still held).`);
			proc.kill('SIGTERM');
			process.exit(2);
		}

		writeTrace();
		console.log(`PASS[${EXPERIMENT}]: second turn progressed with ${progress}`);
		proc.kill('SIGTERM');
		process.exit(0);
	} catch (err) {
		log({phase: 'error', message: String(err)});
		probeAdmin('on_error');
		writeTrace();
		console.error(String(err));
		proc.kill('SIGTERM');
		process.exit(1);
	}
}

main();
