#!/usr/bin/env node
/**
 * Reproduce screenshot: SkillSlash finishes prose (grilling-style) but Stop stays lit.
 * Captures full Bridge event types + Composer Gate after quiet period.
 *
 * FAIL when: after QUIET_MS with no new out events, gate.canCancel || runState!==idle
 *            AND no turn_finished/turn_cancelled.
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
const QUIET_MS = Number(process.env.QUIET_MS ?? 15_000);
const READY_BUDGET_MS = Number(process.env.READY_BUDGET_MS ?? 90_000);

async function loadSessionView() {
	const src = join(__dirname, '../../../packages/core/session-view/src/index.ts');
	await import('tsx/esm').catch(() => {});
	return import(src);
}

const grillingSkill = process.env.FAST_SKILL_GRILLING ?? join(homedir(), '.agents', 'skills', 'grilling', 'SKILL.md');
const grillingBody = existsSync(grillingSkill)
	? readFileSync(grillingSkill, 'utf8')
	: `---
name: grilling
description: grill
---
Ask one decision question with your recommendation, then wait for my answer.
`;

const workdir = process.env.WORKDIR ?? mkdtempSync(join(tmpdir(), 'grill-stuck-'));
const skillDir = join(workdir, '.agents', 'skills', 'grilling');
mkdirSync(skillDir, {recursive: true});
writeFileSync(join(skillDir, 'SKILL.md'), grillingBody);

const runtimeRoot = mkdtempSync(join(tmpdir(), 'grill-rt-'));
const tracePath = join(mkdtempSync(join(tmpdir(), 'grill-trace-')), 'trace.jsonl');

const events = [];
const log = row => {
	events.push(row);
	process.stderr.write(`[grill] ${JSON.stringify(row)}\n`);
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
			log({dir: 'out-raw', line: line.slice(0, 200)});
			return;
		}
		log({
			t: Date.now(),
			dir: 'out',
			type: obj.type,
			turnId: obj.turnId,
			runId: obj.runId,
			success: obj.success,
			name: obj.name,
			question: typeof obj.question === 'string' ? obj.question.slice(0, 80) : undefined,
			text: typeof obj.text === 'string' ? obj.text.slice(0, 120) : undefined,
			message: typeof obj.message === 'string' ? obj.message.slice(0, 100) : undefined
		});
		if (obj.type === 'ready') sessionId = String(obj.sessionId ?? '');
		try {
			transcript = applyBridgeEvent(transcript, obj);
			snap(`event:${obj.type}`);
		} catch (e) {
			log({phase: 'apply_error', err: String(e?.message || e)});
		}
	});
	createInterface({input: proc.stderr}).on('line', line => {
		if (/skillSlash|ERROR|Exception|WaitingQuestion|finishHost/.test(line)) {
			log({dir: 'err', line: line.slice(0, 300)});
		}
	});

	try {
		await waitFor(e => e.dir === 'out' && e.type === 'ready', 'ready', READY_BUDGET_MS);
		// Prompt similar to user grilling usage
		send(proc, {
			type: 'command',
			name: 'grilling',
			args: '围绕 skills 生态与 codebase-design 的关系追问，给出推荐后停下来等我回答',
			sessionId
		});

		await waitFor(
			e =>
				e.dir === 'out' &&
				(e.type === 'assistant_delta' ||
					e.type === 'question_requested' ||
					e.type === 'turn_finished' ||
					e.type === 'turn_cancelled' ||
					e.type === 'run_failed'),
			'progress',
			180_000
		);

		// Quiet wait: no new outbound events
		let lastOut = Date.now();
		const startQuiet = Date.now();
		while (Date.now() - startQuiet < QUIET_MS) {
			await new Promise(r => setTimeout(r, 250));
			const latest = [...events].reverse().find(e => e.dir === 'out');
			if (latest && latest.t > lastOut) lastOut = latest.t;
			if (Date.now() - lastOut >= QUIET_MS) break;
			snap('quiet-probe');
		}

		const types = events.filter(e => e.dir === 'out').map(e => e.type);
		const gate = snap('final');
		const hasTerminal = types.includes('turn_finished') || types.includes('turn_cancelled');
		const hasQuestion = types.includes('question_requested');
		const stopLit = gate.canCancel || gate.runState !== 'idle';
		const bug = stopLit && !hasTerminal;

		const verdict = {
			phase: 'verdict',
			bug,
			stopLit,
			hasTerminal,
			hasQuestion,
			gate,
			outTypes: types,
			workdir,
			tracePath
		};
		log(verdict);
		writeFileSync(tracePath, events.map(e => JSON.stringify(e)).join('\n') + '\n');
		console.log(JSON.stringify(verdict, null, 2));
		proc.kill('SIGTERM');
		process.exit(bug ? 2 : 0);
	} catch (err) {
		log({phase: 'error', err: String(err?.message || err)});
		writeFileSync(tracePath, events.map(e => JSON.stringify(e)).join('\n') + '\n');
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
