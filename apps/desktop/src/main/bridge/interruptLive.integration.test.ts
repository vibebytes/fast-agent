/**
 * Live-engine「插话」(InterruptWithMessage) E2E — drives the REAL machine-scoped
 * Bridge host over the production unix transport (@fastllm/bridge-client), no mocks.
 *
 * Skips unless ~/.fast/run/bridge.sock is accepting (Fast.app / bridge daemon
 * running). Uses a throwaway tmp workspace so user sessions are untouched.
 *
 * Contract:
 *   busy submit          → command_result(status=queued) + follow_up_changed(items=[itemId])
 *   InterruptWithMessage → command_result(accepted, "interrupt_started")
 *                        → cancellation of turn1 (run_cancelled/turn_cancelled)
 *                        → follow_up_changed(items=[])
 *                        → input_accepted(cid3) → final_answer → turn_finished(success)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {BridgeHost, tryConnectUnix} from '@fastllm/bridge-client';

const SOCKET = join(homedir(), '.fast/run/bridge.sock');
const PROGRESS_BUDGET_MS = 120_000;
const QUEUE_BUDGET_MS = 30_000;
const SETTLE_BUDGET_MS = 45_000;
const TURN_FINISH_BUDGET_MS = 240_000;

async function until<T>(
	probe: () => T,
	predicate: (value: T) => boolean,
	what: string,
	budgetMs: number,
	context?: () => string
): Promise<NonNullable<T>> {
	const deadline = Date.now() + budgetMs;
	let current = probe();
	while (current == null || !predicate(current)) {
		if (Date.now() > deadline) {
			assert.fail(`timeout waiting for ${what}${context ? `; ${context()}` : ''}`);
		}
		await new Promise(resolve => setTimeout(resolve, 25));
		current = probe();
	}
	return current;
}

function tail(events: BridgeEvent[]): string {
	return events.slice(-10).map(e => `${e.type}${'message' in e ? `:${String(e.message).slice(0, 80)}` : ''}`).join(' | ');
}

test('插话 interrupts a streaming turn on the live engine (unix transport)', {timeout: 420_000}, async () => {
	const accepting = await tryConnectUnix(SOCKET, 2_000);
	if (!accepting) {
		console.warn(`[interrupt-live] no live bridge host at ${SOCKET}; skipping`);
		return;
	}

	const workspaceRoot = mkdtempSync(join(tmpdir(), 'interrupt-live-'));
	const events: BridgeEvent[] = [];
	const errors: string[] = [];
	const host = new BridgeHost();
	await host.connect(
		{
			clientKind: 'fast-ide',
			clientId: `interrupt-e2e-${randomUUID()}`,
			cwd: workspaceRoot,
			heartbeatMs: 0
		},
		{
			onEvent: event => events.push(event),
			onError: message => errors.push(message),
			onClose: () => undefined
		}
	);
	try {
		const taskId = `task-${randomUUID()}`;
		let sessionId = '';
		for (let attempt = 0; attempt < 2 && !sessionId; attempt++) {
			host.send({
				type: 'CreateProject',
				projectType: 'coding',
				rootPath: workspaceRoot,
				displayName: 'interrupt-live-e2e'
			});
			const project = await until(
				() => events.find(e => e.type === 'command_result' && (e as {name?: string}).name === 'CreateProject') as
					| Extract<BridgeEvent, {type: 'command_result'}>
					| undefined,
				e => !!e && e.status !== undefined,
				'CreateProject result',
				60_000
			);
			assert.equal(project.status, 'accepted', `CreateProject failed: ${project.message}`);
			const projectId = String((project as {projectId?: string}).projectId ?? '');
			assert.ok(projectId, 'CreateProject returned no projectId');

			host.send({type: 'CreateSession', projectId, title: '插话E2E', taskId});
			const created = await until(
				() => events.find(e => e.type === 'command_result' && (e as {name?: string}).name === 'CreateSession') as
					| Extract<BridgeEvent, {type: 'command_result'}>
					| undefined,
				e => !!e && e.status !== undefined,
				'CreateSession result',
				60_000
			);
			if (created.status === 'accepted') {
				sessionId = String((created as {sessionId?: string}).sessionId ?? '');
			}
		}
		assert.ok(sessionId, 'CreateSession did not succeed after retry');

		host.send({type: 'AttachSession', sessionId, clientId: `cli-${taskId}`, lastEventSeq: 0, limit: 20});

		const cid1 = `cid-1-${Date.now()}`;
		host.send({
			type: 'SubmitUserMessage',
			sessionId,
			clientMessageId: cid1,
			text: '请写一篇约2000字的短文，主题是深海城市。直接输出正文，不要解释。'
		});
		await until(
			() => events.some(e => e.type === 'assistant_delta' || e.type === 'reasoning_delta' || e.type === 'tool_started'),
			ok => ok,
			'turn1 streaming progress',
			PROGRESS_BUDGET_MS,
			() => `tail=[${tail(events)}] errors=[${errors.join('|')}]`
		);

		const cid2 = `cid-2-${Date.now()}`;
		host.send({type: 'SubmitUserMessage', sessionId, clientMessageId: cid2, text: '（排队消息）总结一下刚才的内容'});
		await until(
			() => events.some(e => e.type === 'command_result' && (e as {status?: string}).status === 'queued'),
			ok => ok,
			'busy submit queued',
			QUEUE_BUDGET_MS
		);
		const fuChanged = [...events].reverse().find(e => e.type === 'follow_up_changed') as
			| Extract<BridgeEvent, {type: 'follow_up_changed'}>
			| undefined;
		let itemId = '';
		try {
			const items = JSON.parse(String(fuChanged?.itemsJson ?? '[]')) as Array<{id?: string}>;
			itemId = String(items[items.length - 1]?.id ?? '');
		} catch {}
		assert.ok(itemId, 'no follow-up itemId after busy submit');

		const tInterrupt = Date.now();
		const cid3 = `cid-3-${Date.now()}`;
		host.send({
			type: 'InterruptWithMessage',
			sessionId,
			text: '（插话）停下当前任务，只回复两个字：收到',
			clientMessageId: cid3,
			itemId
		});

		const acked = await until(
			() =>
				events.find(
					e => e.type === 'command_result' && (e as {name?: string}).name === 'InterruptWithMessage'
				) as Extract<BridgeEvent, {type: 'command_result'}> | undefined,
			e => e?.status === 'accepted',
			'interrupt accepted',
			SETTLE_BUDGET_MS,
			() => `tail=[${tail(events)}] errors=[${errors.join('|')}]`
		);
		assert.ok(String(acked.message ?? '').includes('interrupt_started'), `unexpected ack: ${acked.message}`);

		await until(
			() =>
				events.some(
					e => (e.type === 'run_cancelled' || e.type === 'turn_cancelled') && Date.now() >= tInterrupt - 5_000
				),
			ok => ok,
			'turn1 cancellation event',
			SETTLE_BUDGET_MS,
			() => `tail=[${tail(events)}] errors=[${errors.join('|')}]`
		);

		await until(
			() =>
				events.some(e => {
					if (e.type !== 'follow_up_changed' || Date.now() < tInterrupt) return false;
					try {
						return (JSON.parse(String((e as {itemsJson?: string}).itemsJson ?? '[]')) as unknown[]).length === 0;
					} catch {
						return false;
					}
				}),
			ok => ok,
			'follow_up drained',
			SETTLE_BUDGET_MS,
			() => `tail=[${tail(events)}] errors=[${errors.join('|')}]`
		);

		await until(
			() =>
				events.some(
					e =>
						e.type === 'turn_started' &&
						String((e as {clientMessageId?: string}).clientMessageId ?? '') === cid3
				),
			ok => ok,
			'turn2 turn_started',
			SETTLE_BUDGET_MS,
			() => `tail=[${tail(events)}] errors=[${errors.join('|')}]`
		);
		const latencyMs = Date.now() - tInterrupt;

		const finished = await until(
			() => events.filter(e => e.type === 'turn_finished').pop() as
				| Extract<BridgeEvent, {type: 'turn_finished'}>
				| undefined,
			e => !!e && Date.now() >= tInterrupt,
			'turn2 turn_finished',
			TURN_FINISH_BUDGET_MS
		);
		assert.notEqual(finished.success, false, 'turn2 finished unsuccessful');

		const answer = [...events].reverse().find(e => e.type === 'final_answer') as
			| Extract<BridgeEvent, {type: 'final_answer'}>
			| undefined;
		console.info(
			`[interrupt-live] PASS cancel→turn2 start=${latencyMs}ms answer="${String(answer?.text ?? '').slice(0, 80)}"`
		);
		assert.deepEqual(errors, []);
	} finally {
		host.stop();
	}
});
