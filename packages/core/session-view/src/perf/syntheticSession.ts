import type {BridgeEvent} from '@fastllm/bridge-protocol';

/**
 * Synthetic session generator for the message-flow perf harness
 * (docs/features/message-flow-performance.md 刀 1).
 *
 * Deterministic (no RNG): same options → same event sequence, so phase
 * timings are comparable across runs and machines.
 *
 * Shape mirrors a pathological real session: many turns, streaming deltas
 * with code fences, chunked tool output, and — when `approvals > 0` — a final
 * turn left streaming with pending approvals (the assertion-3 card scenario).
 */
export type SyntheticOptions = {
	/** Completed turns (`FLOW_PERF_TURNS`, scaled by `scale`). */
	turns: number;
	/** Assistant deltas per turn (`FLOW_PERF_DELTAS_PER_TURN`). */
	deltasPerTurn: number;
	/** Characters per delta (`FLOW_PERF_DELTA_LEN`). */
	deltaLen: number;
	/** Tool calls per turn, each with chunked output (`FLOW_PERF_TOOLS_PER_TURN`). */
	toolsPerTurn: number;
	/** Pending approvals on a trailing still-streaming turn (`FLOW_PERF_APPROVALS`). */
	approvals: number;
	/** Multiplier on `turns` (`FLOW_PERF_SCALE`). */
	scale: number;
};

export const SYNTHETIC_DEFAULTS: SyntheticOptions = {
	turns: 50,
	deltasPerTurn: 200,
	deltaLen: 40,
	toolsPerTurn: 4,
	approvals: 2,
	scale: 1
};

function envInt(env: Record<string, string | undefined>, key: string, fallback: number): number {
	const raw = env[key];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function processEnv(): Record<string, string | undefined> {
	// Avoid a hard `process` reference so renderer tsconfig (no Node types) can
	// still typecheck this shared harness helper through workspace path maps.
	const g = globalThis as {process?: {env?: Record<string, string | undefined>}};
	return g.process?.env ?? {};
}

export function syntheticOptionsFromEnv(
	env: Record<string, string | undefined> = processEnv()
): SyntheticOptions {
	return {
		turns: envInt(env, 'FLOW_PERF_TURNS', SYNTHETIC_DEFAULTS.turns),
		deltasPerTurn: envInt(env, 'FLOW_PERF_DELTAS_PER_TURN', SYNTHETIC_DEFAULTS.deltasPerTurn),
		deltaLen: envInt(env, 'FLOW_PERF_DELTA_LEN', SYNTHETIC_DEFAULTS.deltaLen),
		toolsPerTurn: envInt(env, 'FLOW_PERF_TOOLS_PER_TURN', SYNTHETIC_DEFAULTS.toolsPerTurn),
		approvals: envInt(env, 'FLOW_PERF_APPROVALS', SYNTHETIC_DEFAULTS.approvals),
		scale: Math.max(1, envInt(env, 'FLOW_PERF_SCALE', SYNTHETIC_DEFAULTS.scale))
	};
}

const WORDS = ['flow', 'render', 'frame', 'patch', 'entry', 'delta', 'tool', 'scroll'];

/** Deterministic prose chunk of exactly `len` chars (seeded by indices, no RNG). */
function deltaText(turn: number, delta: number, len: number): string {
	let out = '';
	let i = turn * 31 + delta * 7;
	while (out.length < len) {
		out += `${WORDS[i % WORDS.length]} `;
		i += 1;
	}
	return out.slice(0, len);
}

/** Every ~10th delta opens/closes a code fence so markdown split paths are exercised. */
function fencedDelta(turn: number, delta: number, len: number): string {
	if (delta % 10 === 3) return '\n```ts\n' + deltaText(turn, delta, len);
	if (delta % 10 === 6) return deltaText(turn, delta, len) + '\n```\n';
	return deltaText(turn, delta, len);
}

function toolOutput(turn: number, tool: number, chunk: number): string {
	return `out t${turn} tool${tool} chunk${chunk}: ${deltaText(turn, tool * 3 + chunk, 120)}\n`;
}

/**
 * Generate the full Bridge event sequence.
 *
 * Layout: `turns` completed turns (reasoning ×2 → deltas ×N with fences →
 * tools ×K with 2 output chunks each → turn_finished), then — if
 * `approvals > 0` — one trailing turn left **streaming** with that many
 * `approval_requested` pending and a few more deltas after the request
 * (streaming + pending card coexistence).
 */
export function syntheticSession(opts: SyntheticOptions = SYNTHETIC_DEFAULTS): BridgeEvent[] {
	const events: BridgeEvent[] = [];
	const totalTurns = opts.turns * opts.scale;

	for (let t = 0; t < totalTurns; t++) {
		const turnId = `turn-${t}`;
		events.push({
			type: 'turn_started',
			turnId,
			clientMessageId: `client-${t}`,
			text: `user prompt ${t}: ${deltaText(t, 0, 60)}`
		});
		events.push({type: 'reasoning_delta', turnId, text: `thinking about step ${t} `});
		events.push({type: 'reasoning_delta', turnId, text: 'considering options.'});
		for (let d = 0; d < opts.deltasPerTurn; d++) {
			events.push({type: 'assistant_delta', turnId, text: fencedDelta(t, d, opts.deltaLen)});
		}
		for (let k = 0; k < opts.toolsPerTurn; k++) {
			const id = `tool-${t}-${k}`;
			events.push({
				type: 'tool_started',
				turnId,
				id,
				tool: k % 2 === 0 ? 'shell' : 'read_file',
				args: k % 2 === 0 ? {command: `echo run ${t}-${k}`} : {path: `src/file${t}-${k}.ts`}
			});
			events.push({type: 'tool_output', turnId, id, tool: 'shell', stream: 'stdout', text: toolOutput(t, k, 0)});
			events.push({type: 'tool_output', turnId, id, tool: 'shell', stream: 'stdout', text: toolOutput(t, k, 1)});
			events.push({
				type: 'tool_finished',
				turnId,
				id,
				tool: k % 2 === 0 ? 'shell' : 'read_file',
				success: true,
				fields: {exit_code: '0'}
			});
		}
		events.push({type: 'turn_finished', turnId, success: true});
	}

	if (opts.approvals > 0) {
		const turnId = `turn-live`;
		events.push({
			type: 'turn_started',
			turnId,
			clientMessageId: 'client-live',
			text: 'user prompt live: please run the risky thing'
		});
		for (let d = 0; d < 20; d++) {
			events.push({type: 'assistant_delta', turnId, text: fencedDelta(totalTurns, d, opts.deltaLen)});
		}
		for (let a = 0; a < opts.approvals; a++) {
			events.push({
				type: 'approval_requested',
				runId: turnId,
				turnId,
				id: `approval-${a}`,
				tool: 'shell',
				description: `shell({"command":"rm -rf build && make ${a}"})`,
				risk: 'shell',
				context: `shell({"command":"rm -rf build && make ${a}"})`
			});
		}
		// Streaming continues while the cards are pending (assertion-3 scenario).
		for (let d = 20; d < 30; d++) {
			events.push({type: 'assistant_delta', turnId, text: fencedDelta(totalTurns, d, opts.deltaLen)});
		}
	}

	return events;
}

/** Trailing streaming deltas usable as extra per-frame events (assertion 3 drives 100 frames). */
export function syntheticStreamingDelta(frame: number, deltaLen = SYNTHETIC_DEFAULTS.deltaLen): BridgeEvent {
	return {type: 'assistant_delta', turnId: 'turn-live', text: fencedDelta(9999, frame, deltaLen)};
}
