#!/usr/bin/env node
/**
 * E2E: SkillSlash must finish the thin HOST run when the child completes.
 *
 * Live bug (2026-07-24): child status=completed, host status=running forever →
 * no turn_finished → Fast Stop stuck. Root cause: AgentEntity idle passivation
 * (120s) drops Invoke/ewait callbacks while the child RunEntity is still working.
 *
 * RED when: after QUIET_MS with content done, either
 *   - no turn_finished, or
 *   - admin shows host run still "running" while a child is terminal, or
 *   - composerGate canCancel / runState===running
 *
 * Usage:
 *   node repro-skillslash-host-stuck.mjs
 *   SLEEP_SEC=130  # shell sleep inside fixture (default 130 > passivation 120s)
 */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtempSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {currentEngineCli, currentEngineDir} from '../../../../scripts/current-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_HOME = currentEngineDir();
const AGENT_CLI = currentEngineCli();
const SLEEP_SEC = Number(process.env.SLEEP_SEC ?? 130);
const QUIET_MS = Number(process.env.QUIET_MS ?? 15_000);
const READY_BUDGET_MS = Number(process.env.READY_BUDGET_MS ?? 90_000);

async function loadSessionView() {
	const built = join(__dirname, '../../../packages/core/session-view/dist/index.js');
	if (existsSync(built)) return import(built);
	await import('tsx/esm').catch(() => {});
	return import(join(__dirname, '../../../packages/core/session-view/src/index.ts'));
}

const skillName = 'repro-host-stuck';
const workdir = process.env.WORKDIR ?? mkdtempSync(join(tmpdir(), 'ss-host-'));
const skillDir = join(workdir, '.agents', 'skills', skillName);
mkdirSync(skillDir, {recursive: true});
writeFileSync(
	join(skillDir, 'SKILL.md'),
	`---
name: ${skillName}
description: Repro host stuck after child completes (passivation window)
---
You MUST call the shell tool exactly once with this command and no other tools:
sleep ${SLEEP_SEC} && echo HOST_STUCK_CHILD_DONE

After the tool succeeds, reply with exactly:
HOST_STUCK_OK

Do not ask questions. Do not call ask_user_question.
`
);

const runtimeRoot = mkdtempSync(join(tmpdir(), 'ss-host-rt-'));
const events = [];
const log = row => {
	events.push(row);
	process.stderr.write(`[ss-host] ${JSON.stringify(row)}\n`);
};

function send(proc, obj) {
	log({t: Date.now(), dir: 'in', ...obj});
	proc.stdin.write(JSON.stringify(obj) + '\n');
}

function waitFor(pred, label, ms) {
	return new Promise((resolve, reject) => {
		const t0 = Date.now();
		const id = setInterval(() => {
			const hit = events.find(pred);
			if (hit) {
				clearInterval(id);
				resolve(hit);
				return;
			}
			if (Date.now() - t0 > ms) {
				clearInterval(id);
				reject(new Error(`timeout ${label}`));
			}
		}, 40);
	});
}

async function adminToken(adminBase) {
	const r = await fetch(`${adminBase}/api/v1/system/token`);
	const j = await r.json();
	return j.token;
}

async function sessionRuns(adminBase, token, sessionId) {
	const r = await fetch(`${adminBase}/api/v1/sessions/${sessionId}/runs`, {
		headers: {'X-Admin-Token': token}
	});
	return r.json();
}

async function main() {
	if (!AGENT_CLI || !existsSync(AGENT_CLI)) throw new Error('missing modules/engine/current/bin/fast-cli — pnpm fetch-engine');
	const {applyBridgeEvent, createTranscriptState, composerGate} = await loadSessionView();

	const proc = spawn('/bin/sh', [AGENT_CLI, 'engine', '--mode', 'bridge', '--transport', 'stdio', '--new'], {
		cwd: workdir,
		stdio: ['pipe', 'pipe', 'pipe'],
		env: {
			...process.env,
			JAVA_OPTS: `-Dfast.runtime.root=${runtimeRoot} -Dfast.skills.projectTrusted=true`,
			FAST_SKILLS_PROJECT_TRUSTED: 'true'
		}
	});

	let transcript = createTranscriptState();
	let sessionId = '';
	let adminBase = '';
	const approved = new Set();

	createInterface({input: proc.stdout}).on('line', line => {
		let obj;
		try {
			obj = JSON.parse(line);
		} catch {
			return;
		}
		log({
			t: Date.now(),
			dir: 'out',
			type: obj.type,
			turnId: obj.turnId,
			runId: obj.runId,
			sessionId: obj.sessionId,
			success: obj.success,
			tool: obj.tool,
			message: typeof obj.message === 'string' ? obj.message.slice(0, 120) : undefined,
			text: typeof obj.text === 'string' ? obj.text.slice(0, 80) : undefined
		});
		if (obj.type === 'ready') sessionId = String(obj.sessionId ?? '');
		if (obj.type === 'engine_status' && typeof obj.message === 'string' && obj.message.includes('http')) {
			adminBase = obj.message.replace(/\/$/, '');
		}
		try {
			transcript = applyBridgeEvent(transcript, obj);
		} catch (e) {
			log({phase: 'apply_error', err: String(e?.message || e)});
		}
		if (obj.type === 'approval_requested' && obj.id && !approved.has(obj.id)) {
			approved.add(obj.id);
			const runId = obj.runId ?? obj.turnId;
			if (runId) {
				send(proc, {
					type: 'DecideApproval',
					sessionId: obj.sessionId ?? sessionId,
					runId,
					approvalId: obj.id,
					approved: true
				});
			}
		}
	});

	try {
		await waitFor(e => e.dir === 'out' && e.type === 'ready', 'ready', READY_BUDGET_MS);
		send(proc, {type: 'command', name: skillName, args: '', sessionId});

		const budget = (SLEEP_SEC + 180) * 1000;
		await waitFor(
			e =>
				e.dir === 'out' &&
				(e.type === 'assistant_delta' || e.type === 'turn_finished' || e.type === 'turn_cancelled'),
			'progress',
			budget
		);

		const t0 = Date.now();
		while (Date.now() - t0 < budget) {
			const types = events.filter(e => e.dir === 'out').map(e => e.type);
			if (types.includes('turn_finished') || types.includes('turn_cancelled')) break;
			const lastOut = [...events].reverse().find(e => e.dir === 'out');
			if (lastOut && Date.now() - lastOut.t >= QUIET_MS) break;
			await new Promise(r => setTimeout(r, 500));
		}

		const types = events.filter(e => e.dir === 'out').map(e => e.type);
		const gate = composerGate(transcript, true);
		const hasTerminal = types.includes('turn_finished') || types.includes('turn_cancelled');
		const stopLit = gate.canCancel === true || gate.runState === 'running' || gate.runState === 'stopping';

		let hostRunningWithChildDone = false;
		let runs = [];
		if (adminBase && sessionId) {
			try {
				const tok = await adminToken(adminBase);
				runs = await sessionRuns(adminBase, tok, sessionId);
				const list = Array.isArray(runs) ? runs : [];
				const hosts = list.filter(r => String(r.trigger_key || '').startsWith('skill-host-'));
				const children = list.filter(r => r.parent_run_id);
				const childDone = children.some(r =>
					['completed', 'failed', 'cancelled', 'exhausted'].includes(r.status)
				);
				hostRunningWithChildDone = childDone && hosts.some(r => r.status === 'running');
			} catch (e) {
				log({phase: 'admin_error', err: String(e?.message || e), adminBase});
			}
		}

		const bug =
			hostRunningWithChildDone ||
			(!hasTerminal && stopLit) ||
			(hasTerminal && stopLit);

		const verdict = {
			phase: 'verdict',
			bug,
			hostRunningWithChildDone,
			hasTerminal,
			stopLit,
			runState: gate.runState,
			canCancel: gate.canCancel,
			canSubmitNow: gate.canSubmitNow,
			sleepSec: SLEEP_SEC,
			adminBase,
			runs: (Array.isArray(runs) ? runs : []).map(r => ({
				id: r.id,
				status: r.status,
				parent: r.parent_run_id,
				trigger: r.trigger_key
			})),
			outTypes: types
		};
		log(verdict);
		console.log(JSON.stringify(verdict, null, 2));
		proc.kill('SIGTERM');
		process.exit(bug ? 2 : 0);
	} catch (err) {
		log({phase: 'error', err: String(err?.message || err)});
		try {
			proc.kill('SIGKILL');
		} catch {
			/* */
		}
		console.error(String(err?.message || err));
		process.exit(1);
	}
}

main();
