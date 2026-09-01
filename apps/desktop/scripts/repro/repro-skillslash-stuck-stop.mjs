#!/usr/bin/env node
/**
 * Repro: SkillSlash finishes visible output (asks a question) but Composer stays
 * running (Stop lit) — matches Fast screenshot after /grilling.
 *
 * Two fixtures:
 *   A) skill that MUST call ask_user_question then stop
 *   B) skill that ends with plain-text question via final answer only
 *
 * Symptom (BUG): after last assistant content / question_requested, within
 * QUIET_MS there is still no turn_finished|turn_cancelled AND gate.runState
 * is still 'running' (Stop would stay lit).
 *
 * Usage:
 *   FIXTURE=ask|text|both node repro-skillslash-stuck-stop.mjs
 */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtempSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {currentEngineCli, currentEngineDir} from '../../../../scripts/current-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadSessionView() {
	const built = join(__dirname, '../../../packages/core/session-view/dist/index.js');
	if (existsSync(built)) return import(built);
	await import('tsx/esm').catch(() => {});
	return import(join(__dirname, '../../../packages/core/session-view/src/index.ts'));
}

const AGENT_HOME = currentEngineDir();
const AGENT_CLI = currentEngineCli();
const QUIET_MS = Number(process.env.QUIET_MS ?? 8_000);
const READY_BUDGET_MS = Number(process.env.READY_BUDGET_MS ?? 90_000);
const FIXTURE = (process.env.FIXTURE ?? 'both').toLowerCase();

const fixtures = {
	ask: {
		name: 'repro-ask-stop',
		body: `---
name: repro-ask-stop
description: Repro SkillSlash stuck Stop via ask_user_question
---
You MUST call the ask_user_question tool exactly once with:
- title: "Pick"
- question: "Which candidate?"
- options: [{"id":"a","label":"A"},{"id":"b","label":"B"}]
- allowCustom: true
Then stop and wait for the tool result. Do not write a final answer before the tool returns.
Do not call any other tools.
`
	},
	text: {
		name: 'repro-text-stop',
		body: `---
name: repro-text-stop
description: Repro SkillSlash stuck Stop via plain-text question
---
Reply with exactly this markdown and nothing else (no tools):

**Top Recommendation:** Candidate 1

这些 candidate 中你想深入探讨哪个？
`
	}
};

function pickFixtures() {
	if (FIXTURE === 'ask') return [fixtures.ask];
	if (FIXTURE === 'text') return [fixtures.text];
	return [fixtures.ask, fixtures.text];
}

function send(proc, obj, log) {
	const row = {t: Date.now(), dir: 'in', ...obj};
	log(row);
	proc.stdin.write(JSON.stringify(obj) + '\n');
}

function waitFor(events, pred, label, timeoutMs) {
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
				reject(new Error(`timeout waiting for ${label}`));
			}
		}, 40);
	});
}

async function runFixture(fixture, sessionView) {
	const {applyBridgeEvent, createTranscriptState, composerGate} = sessionView;
	const workdir = mkdtempSync(join(tmpdir(), `ssl-stuck-${fixture.name}-`));
	const skillDir = join(workdir, '.agents', 'skills', fixture.name);
	mkdirSync(skillDir, {recursive: true});
	writeFileSync(join(skillDir, 'SKILL.md'), fixture.body);

	const runtimeRoot = mkdtempSync(join(tmpdir(), 'ssl-stuck-rt-'));
	const tracePath = join(mkdtempSync(join(tmpdir(), 'ssl-stuck-trace-')), `${fixture.name}.jsonl`);
	const events = [];
	const log = row => {
		events.push(row);
		process.stderr.write(`[${fixture.name}] ${JSON.stringify(row)}\n`);
	};

	const proc = spawn(
		'/bin/sh',
		[AGENT_CLI, 'engine', '--mode', 'bridge', '--transport', 'stdio', '--new'],
		{
			cwd: workdir,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: {
				...process.env,
				JAVA_OPTS: `${process.env.JAVA_OPTS ?? ''} -Dfast.runtime.root=${runtimeRoot} -Dfast.skills.projectTrusted=true`.trim(),
				FAST_SKILLS_PROJECT_TRUSTED: 'true'
			}
		}
	);

	let transcript = createTranscriptState();
	let sessionId = '';

	const snapshot = reason => {
		const gate = composerGate(transcript, true);
		const snap = {
			t: Date.now(),
			phase: 'gate',
			reason,
			runState: gate.runState,
			canCancel: gate.canCancel,
			canEnqueue: gate.canEnqueue,
			canSubmitNow: gate.canSubmitNow,
			composerLocked: gate.composerLocked,
			activeRunId: transcript.activeRunId,
			streaming: transcript.entries.filter(e => e.status === 'streaming').length,
			questions: transcript.questions?.length ?? 0
		};
		log(snap);
		return snap;
	};

	const rlOut = createInterface({input: proc.stdout});
	const rlErr = createInterface({input: proc.stderr});
	rlOut.on('line', line => {
		let obj;
		try {
			obj = JSON.parse(line);
		} catch {
			log({dir: 'out-raw', line: line.slice(0, 300)});
			return;
		}
		log({
			dir: 'out',
			type: obj.type,
			turnId: obj.turnId,
			success: obj.success,
			text: typeof obj.text === 'string' ? obj.text.slice(0, 100) : undefined,
			question: typeof obj.question === 'string' ? obj.question.slice(0, 80) : undefined,
			name: obj.name,
			message: typeof obj.message === 'string' ? obj.message.slice(0, 100) : undefined
		});
		if (obj.type === 'ready') sessionId = String(obj.sessionId ?? '');
		try {
			transcript = applyBridgeEvent(transcript, obj);
			snapshot(`event:${obj.type}`);
		} catch (err) {
			log({phase: 'apply_error', err: String(err?.message || err)});
		}
	});
	rlErr.on('line', line => log({dir: 'err', line: line.slice(0, 240)}));

	try {
		await waitFor(events, e => e.dir === 'out' && e.type === 'ready', 'ready', READY_BUDGET_MS);
		send(proc, {type: 'command', name: fixture.name, args: '', sessionId}, log);

		// Progress: content, structured question, or terminal
		await waitFor(
			events,
			e =>
				e.dir === 'out' &&
				(e.type === 'assistant_delta' ||
					e.type === 'question_requested' ||
					e.type === 'clarify' ||
					e.type === 'turn_finished' ||
					e.type === 'turn_cancelled' ||
					e.type === 'agent_call_finished' ||
					e.type === 'run_failed'),
			'progress',
			120_000
		);

		const progressAt = Date.now();
		const quietDeadline = progressAt + QUIET_MS;
		while (Date.now() < quietDeadline) {
			await new Promise(r => setTimeout(r, 200));
			const terminal = events.some(
				e => e.dir === 'out' && (e.type === 'turn_finished' || e.type === 'turn_cancelled')
			);
			if (terminal) break;
			// keep sampling gate while quiet
			if (Date.now() - progressAt > 1000) snapshot('quiet-probe');
		}

		const types = events.filter(e => e.dir === 'out').map(e => e.type);
		const gate = snapshot('final');
		const hasTerminal = types.includes('turn_finished') || types.includes('turn_cancelled');
		const hasQuestion = types.includes('question_requested') || types.includes('clarify');
		// Fast Stop button is bound to canCancel (DialogueComposer / MessageStopHost).
		const stopLit =
			gate.canCancel === true || gate.runState === 'running' || gate.runState === 'stopping';
		// Symptom: after question handoff (or quiet completion), Stop still lit.
		const bug = hasQuestion ? stopLit : stopLit && !hasTerminal;

		const verdict = {
			phase: 'verdict',
			fixture: fixture.name,
			bug,
			stopLit,
			hasTerminal,
			hasQuestion,
			runState: gate.runState,
			questions: gate.questions,
			activeRunId: gate.activeRunId,
			streaming: gate.streaming,
			outTypes: types,
			quietMs: QUIET_MS
		};
		log(verdict);
		writeFileSync(tracePath, events.map(e => JSON.stringify(e)).join('\n') + '\n');
		log({phase: 'trace', tracePath});

		proc.kill('SIGTERM');
		await new Promise(r => setTimeout(r, 400));
		return verdict;
	} catch (err) {
		log({phase: 'error', err: String(err?.message || err)});
		writeFileSync(tracePath, events.map(e => JSON.stringify(e)).join('\n') + '\n');
		try {
			proc.kill('SIGKILL');
		} catch {
			/* ignore */
		}
		return {phase: 'verdict', fixture: fixture.name, bug: true, error: String(err?.message || err)};
	}
}

async function main() {
	if (!AGENT_CLI || !existsSync(AGENT_CLI)) {
		console.error('fast-cli missing: modules/engine/current/bin/fast-cli — pnpm fetch-engine');
		process.exit(1);
	}
	const sessionView = await loadSessionView();
	const results = [];
	for (const f of pickFixtures()) {
		results.push(await runFixture(f, sessionView));
	}
	console.log(JSON.stringify({results}, null, 2));
	const anyBug = results.some(r => r.bug);
	if (anyBug) {
		console.error('FAIL: SkillSlash left Stop lit without turn settle');
		process.exit(2);
	}
	console.log('PASS: all fixtures settled or idle');
	process.exit(0);
}

main();
