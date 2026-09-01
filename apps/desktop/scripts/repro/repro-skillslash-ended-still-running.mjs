#!/usr/bin/env node
/**
 * User scenario: SkillSlash finishes → run state must stop (Stop off).
 *
 * RED when either:
 *  A) turn_finished/turn_cancelled arrived AND gate still canCancel / runState≠idle
 *  B) after QUIET_MS with no new events: Stop still lit AND no pending
 *     question/approval (looks "done" to user, composer still running)
 *
 * On approval_requested: auto-approve so the skill can actually finish.
 */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {currentEngineCli, currentEngineDir} from '../../../../scripts/current-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_HOME = currentEngineDir();
const AGENT_CLI = currentEngineCli();
const QUIET_MS = Number(process.env.QUIET_MS ?? 12_000);
const READY_BUDGET_MS = Number(process.env.READY_BUDGET_MS ?? 90_000);
const SKILL = process.env.SKILL ?? 'grilling';

async function loadSessionView() {
	await import('tsx/esm').catch(() => {});
	return import(join(__dirname, '../../../packages/core/session-view/src/index.ts'));
}

const grillingSkill = process.env.FAST_SKILL_GRILLING ?? join(homedir(), '.agents', 'skills', 'grilling', 'SKILL.md');
const grillingBody = existsSync(grillingSkill)
	? readFileSync(grillingSkill, 'utf8')
	: `---
name: grilling
description: grill
---
Ask one decision question, then wait.
`;

const workdir = process.env.WORKDIR ?? mkdtempSync(join(tmpdir(), 'ss-ended-'));
const skillDir = join(workdir, '.agents', 'skills', SKILL);
mkdirSync(skillDir, {recursive: true});
if (SKILL === 'grilling') writeFileSync(join(skillDir, 'SKILL.md'), grillingBody);
else if (!existsSync(join(skillDir, 'SKILL.md'))) {
	writeFileSync(
		join(skillDir, 'SKILL.md'),
		`---
name: ${SKILL}
description: end cleanly
---
Reply with one short paragraph. Do not call tools. Then stop.
`
	);
}

const runtimeRoot = mkdtempSync(join(tmpdir(), 'ss-ended-rt-'));
const events = [];
const log = row => {
	events.push(row);
	process.stderr.write(`[ss-ended] ${JSON.stringify(row)}\n`);
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
	const approved = new Set();

	const snap = reason => {
		const g = composerGate(transcript, true);
		const s = {
			t: Date.now(),
			phase: 'gate',
			reason,
			runState: g.runState,
			canCancel: g.canCancel,
			canEnqueue: g.canEnqueue,
			canSubmitNow: g.canSubmitNow,
			composerLocked: g.composerLocked,
			activeRunId: transcript.activeRunId,
			streaming: transcript.entries.filter(e => e.status === 'streaming').length,
			questions: transcript.questions.length,
			approvals: transcript.approvals.length,
			entryStatuses: transcript.entries.map(e => `${e.role}:${e.status}`).join(',')
		};
		log(s);
		return s;
	};

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
			id: obj.id,
			sessionId: obj.sessionId,
			tool: obj.tool,
			success: obj.success,
			text: typeof obj.text === 'string' ? obj.text.slice(0, 100) : undefined
		});
		if (obj.type === 'ready') sessionId = String(obj.sessionId ?? '');
		try {
			transcript = applyBridgeEvent(transcript, obj);
			snap(`event:${obj.type}`);
		} catch (e) {
			log({phase: 'apply_error', err: String(e?.message || e)});
		}

		// Auto-approve so SkillSlash can reach a real end (user scenario: skill ends).
		if (process.env.NO_APPROVE !== '1' && obj.type === 'approval_requested' && obj.id && !approved.has(obj.id)) {
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
	createInterface({input: proc.stderr}).on('line', line => {
		if (/skillSlash|finishHost|ERROR|Exception/.test(line)) {
			log({dir: 'err', line: line.slice(0, 300)});
		}
	});

	try {
		await waitFor(e => e.dir === 'out' && e.type === 'ready', 'ready', READY_BUDGET_MS);
		send(proc, {
			type: 'command',
			name: SKILL,
			args:
				process.env.SKILL_ARGS ??
				'围绕 skills 与 codebase-design 给一个简短推荐后结束（不要长时间追问）',
			sessionId
		});

		await waitFor(
			e =>
				e.dir === 'out' &&
				(e.type === 'assistant_delta' ||
					e.type === 'question_requested' ||
					e.type === 'approval_requested' ||
					e.type === 'turn_finished' ||
					e.type === 'turn_cancelled' ||
					e.type === 'run_failed'),
			'progress',
			180_000
		);

		// Wait for terminal OR quiet
		const tProgress = Date.now();
		while (Date.now() - tProgress < 120_000) {
			const types = events.filter(e => e.dir === 'out').map(e => e.type);
			if (types.includes('turn_finished') || types.includes('turn_cancelled')) break;
			const lastOut = [...events].reverse().find(e => e.dir === 'out');
			if (lastOut && Date.now() - lastOut.t >= QUIET_MS) break;
			await new Promise(r => setTimeout(r, 250));
			snap('wait');
		}

		const types = events.filter(e => e.dir === 'out').map(e => e.type);
		const gate = snap('final');
		const hasTerminal = types.includes('turn_finished') || types.includes('turn_cancelled');
		// Only *pending* prompts count — historical approval_requested must not mask Stop bugs.
		const hasPrompt = gate.questions > 0 || gate.approvals > 0;
		const stopLit = gate.canCancel === true || gate.runState === 'running' || gate.runState === 'stopping';

		// A: skill ended but Stop still lit
		const bugEndedStillRunning = hasTerminal && stopLit;
		// B: looks done (no prompt chrome) but Stop still lit / no terminal
		const bugLooksDoneStillRunning = !hasTerminal && !hasPrompt && stopLit;

		const verdict = {
			phase: 'verdict',
			bug: bugEndedStillRunning || bugLooksDoneStillRunning,
			bugEndedStillRunning,
			bugLooksDoneStillRunning,
			stopLit,
			hasTerminal,
			hasPrompt,
			gate,
			outTypes: types,
			workdir,
			approved: [...approved]
		};
		log(verdict);
		console.log(JSON.stringify(verdict, null, 2));
		proc.kill('SIGTERM');
		process.exit(verdict.bug ? 2 : 0);
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
