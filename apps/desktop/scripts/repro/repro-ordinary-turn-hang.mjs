#!/usr/bin/env node
/**
 * Real fast-cli Bridge e2e: ordinary SkillSlash/shell hang keeps Stop lit;
 * Cancel unlocks the next Submit.
 *
 * Fixture skill forces a long shell sleep (ToolStarted, no finish for a long time)
 * — same Composer symptom as explore-then-missing-RunCompleted (Stop lit for hours).
 *
 * Exit 0 = Cancel unlocked resubmit.
 * Exit 2 = after explore/tool_started, turn_finished arrived early OR Cancel did not unlock.
 *
 * Usage:
 *   node repro-ordinary-turn-hang.mjs
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
const SLEEP_SEC = Number(process.env.SLEEP_SEC ?? 600);
const TOOL_BUDGET_MS = Number(process.env.TOOL_BUDGET_MS ?? 90_000);
const READY_BUDGET_MS = Number(process.env.READY_BUDGET_MS ?? 90_000);
const POST_CANCEL_BUDGET_MS = Number(process.env.POST_CANCEL_BUDGET_MS ?? 30_000);

async function loadSessionView() {
	await import('tsx/esm').catch(() => {});
	return import(join(__dirname, '../../../packages/core/session-view/src/index.ts'));
}

const skillName = 'repro-ordinary-hang';
const workdir = process.env.WORKDIR ?? mkdtempSync(join(tmpdir(), 'ord-hang-'));
const skillDir = join(workdir, '.agents', 'skills', skillName);
mkdirSync(skillDir, {recursive: true});
writeFileSync(
	join(skillDir, 'SKILL.md'),
	`---
name: ${skillName}
description: Force a long shell so ordinary Stop stays lit until Cancel
---
You MUST call the shell tool exactly once with this command and no other tools:
sleep ${SLEEP_SEC}

Do not reply until the tool finishes. Do not ask questions.
`
);

const runtimeRoot = mkdtempSync(join(tmpdir(), 'ord-hang-rt-'));
const events = [];
const log = row => {
	events.push(row);
	process.stderr.write(`[ord-hang] ${JSON.stringify(row)}\n`);
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
	let runId = '';
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
			tool: obj.tool,
			success: obj.success
		});
		if (obj.type === 'ready') sessionId = String(obj.sessionId ?? '');
		if (obj.type === 'input_accepted' && obj.turnId) runId = String(obj.turnId);
		try {
			transcript = applyBridgeEvent(transcript, obj);
		} catch (e) {
			log({phase: 'apply_error', err: String(e?.message || e)});
		}
		if (obj.type === 'approval_requested' && obj.id && !approved.has(obj.id)) {
			approved.add(obj.id);
			const rid = obj.runId ?? obj.turnId;
			if (rid) {
				send(proc, {
					type: 'DecideApproval',
					sessionId: obj.sessionId ?? sessionId,
					runId: rid,
					approvalId: obj.id,
					approved: true
				});
			}
		}
	});

	try {
		await waitFor(e => e.dir === 'out' && e.type === 'ready', 'ready', READY_BUDGET_MS);
		send(proc, {type: 'command', name: skillName, args: '', sessionId});

		await waitFor(
			e => e.dir === 'out' && (e.type === 'tool_started' || e.type === 'approval_requested'),
			'tool_started',
			TOOL_BUDGET_MS
		);

		// Hold briefly — must still be running (no turn_finished).
		await new Promise(r => setTimeout(r, 2000));
		const gateMid = composerGate(transcript, true);
		const typesMid = events.filter(e => e.dir === 'out').map(e => e.type);
		const finishedEarly = typesMid.includes('turn_finished');
		const stopLit = gateMid.canCancel === true || gateMid.runState === 'running';

		if (finishedEarly) {
			log({phase: 'verdict', bug: true, reason: 'turn_finished before Cancel during long sleep'});
			proc.kill('SIGTERM');
			process.exit(2);
		}
		if (!stopLit) {
			log({phase: 'verdict', bug: true, reason: 'Stop not lit while shell sleep running', gate: gateMid});
			proc.kill('SIGTERM');
			process.exit(2);
		}

		const cancelRunId = runId || transcript.activeRunId;
		send(proc, {
			type: 'CancelRun',
			sessionId,
			runId: cancelRunId,
			reason: 'user cancel after hang'
		});

		await waitFor(
			e => e.dir === 'out' && (e.type === 'turn_cancelled' || e.type === 'turn_finished'),
			'cancel settle',
			POST_CANCEL_BUDGET_MS
		);

		const gateAfter = composerGate(transcript, true);
		const canContinue = gateAfter.canSubmitNow === true && gateAfter.canCancel === false;

		const verdict = {
			phase: 'verdict',
			bug: !canContinue,
			stopLitMid: stopLit,
			finishedEarly,
			gateAfter,
			outTypes: events.filter(e => e.dir === 'out').map(e => e.type)
		};
		log(verdict);
		console.log(JSON.stringify(verdict, null, 2));
		proc.kill('SIGTERM');
		process.exit(canContinue ? 0 : 2);
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
