/**
 * EngineSessionHarness — the shared plumbing behind the engine E2E tests.
 *
 * Wraps the production BridgeClient + SessionController over stdio with:
 *   - captured events / logs / sent commands / bridgeError / exit state
 *   - fail-fast event waits that diagnose on timeout (last events, logs, exit)
 *   - sent / commands(type) so a test can assert the exact wire command the
 *     production client produced, not only what the engine wrote back
 *   - close() that stops the bridge and waits for the engine it spawned to exit,
 *     so the next phase never races a half-dead engine
 *
 * Scenario-level helpers (isolated fixture, dsh sidecar) stay in
 * engineE2eFixture.ts / dshScenario.ts; this file is deliberately agnostic.
 */
import assert from 'node:assert/strict';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {BridgeClient} from '../BridgeClient.js';
import {SessionController} from '../SessionController.js';
import type {EngineLaunch} from './engineE2eFixture.js';

export type EngineExit = {code: number | null; signal: string | null};

/** How long close() waits for the engine to leave after stop(). */
const EXIT_GRACE_MS = 15_000;

const safeClip = (s: string, n = 200): string => [...s].slice(0, n).join('');

/** Extra SessionController wiring a scenario needs (workspace hash / Meta project id). */
export type HarnessControllerDeps = {
	workspaceId?: () => string | undefined;
	projectId?: () => string | undefined;
};

export class EngineSessionHarness {
	readonly events: BridgeEvent[] = [];
	readonly logs: string[] = [];
	/** Commands this session actually put on the wire, in order (payload assertions). */
	readonly sent: BridgeCommand[] = [];
	bridgeError = '';
	exited: EngineExit | null = null;

	private readonly exitWaiters: Array<() => void> = [];
	private closed = false;

	private constructor(
		readonly launch: EngineLaunch,
		readonly bridge: BridgeClient,
		readonly controller: SessionController
	) {}

	static start(
		project: string,
		env: Record<string, string>,
		launch: EngineLaunch,
		clientId: string,
		controllerDeps: HarnessControllerDeps = {}
	): EngineSessionHarness {
		const bridge = new BridgeClient({transport: 'stdio'});
		const sent: BridgeCommand[] = [];
		let cid = 0;
		const controller = new SessionController({
			clientId,
			send: cmd => {
				const ok = bridge.send(cmd);
				if (ok) sent.push(cmd);
				return ok;
			},
			createId: () => `cid-${++cid}`,
			...controllerDeps
		});
		const h = new EngineSessionHarness(launch, bridge, controller);
		// The very array the controller's send thunk fills — one wire log, live view.
		Object.assign(h, {sent});
		bridge.start(project, {
			onEvent: e => {
				h.events.push(e);
				controller.handleEvent(e);
			},
			onLog: line => {
				if (h.logs.length < 500) h.logs.push(line);
			},
			onError: message => {
				h.bridgeError = message;
			},
			onExit: (code, signal) => {
				h.exited = {code, signal};
				for (const wake of h.exitWaiters.splice(0)) wake();
			}
		}, {
			env: {
				...env,
				FAST_ENGINE_COMMAND: launch.command[0],
				FAST_ENGINE_ARGS: launch.command.slice(1).join(' ')
			}
		});
		return h;
	}

	/** Engine provenance (`placed 0.4.5` / `stage agent@abc1234 …`) — part of every diagnostic dump. */
	engineSource(): string {
		return this.launch.source;
	}

	/** Commands of one type this session sent, in order. */
	commands<T extends BridgeCommand['type']>(type: T): Array<Extract<BridgeCommand, {type: T}>> {
		return this.sent.filter(c => c.type === type) as Array<Extract<BridgeCommand, {type: T}>>;
	}

	async waitEvent<T extends BridgeEvent['type']>(
		type: T,
		predicate?: (e: Extract<BridgeEvent, {type: T}>) => boolean,
		opts?: {timeoutMs?: number; what?: string}
	): Promise<Extract<BridgeEvent, {type: T}>> {
		const what = opts?.what ?? type;
		const deadline = Date.now() + (opts?.timeoutMs ?? 90_000);
		for (;;) {
			const hit = this.events.find(
				e => e.type === type && (!predicate || predicate(e as Extract<BridgeEvent, {type: T}>))
			);
			if (hit) return hit as Extract<BridgeEvent, {type: T}>;
			if (this.exited) {
				assert.fail(`${what}: engine exited ${JSON.stringify(this.exited)} before the event arrived\n${this.diagnose()}`);
			}
			if (Date.now() > deadline) assert.fail(`${what} timed out\n${this.diagnose()}`);
			await new Promise(r => setTimeout(r, 250));
		}
	}

	async waitUntil<T>(probe: () => T, predicate: (v: T) => boolean, what: string, timeoutMs = 120_000): Promise<T> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const v = probe();
			if (predicate(v)) return v;
			if (this.exited) assert.fail(`${what}: engine exited ${JSON.stringify(this.exited)}\n${this.diagnose()}`);
			if (Date.now() > deadline) assert.fail(`${what} timed out\n${this.diagnose()}`);
			await new Promise(r => setTimeout(r, 250));
		}
	}

	diagnose(): string {
		return [
			`engine: ${this.launch.source}`,
			this.bridgeError ? `bridgeError: ${this.bridgeError}` : '',
			this.exited ? `exited: ${JSON.stringify(this.exited)}` : '',
			`events: ${this.events.length} sent: ${this.sent.length}`,
			`dsh logs: ${this.logs.filter(l => /dsh|mux|follow|token|auth/i.test(l)).slice(-40).map(safeClip).join('\n')}`,
			...this.logs.slice(-50).map(safeClip),
			`last sent: ${this.sent.slice(-10).map(c => safeClip(JSON.stringify(c))).join('\n')}`,
			`last events: ${this.events.slice(-30).map(e => safeClip(JSON.stringify(e))).join('\n')}`
		]
			.filter(Boolean)
			.join('\n');
	}

	/**
	 * Stop the bridge and wait for the engine process to leave. Idempotent.
	 * Without the wait the next phase — or fixture cleanup — races an engine that
	 * is still shutting down and still writing into the fixture root.
	 */
	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.bridge.stop();
		if (this.exited) return;
		await Promise.race([
			new Promise<void>(resolve => this.exitWaiters.push(resolve)),
			new Promise<void>(resolve => setTimeout(resolve, EXIT_GRACE_MS))
		]);
		if (!this.exited) {
			console.error(
				`[engine-e2e] engine still alive ${EXIT_GRACE_MS}ms after stop() — fixture cleanup will race it\n${this.diagnose()}`
			);
		}
	}
}
