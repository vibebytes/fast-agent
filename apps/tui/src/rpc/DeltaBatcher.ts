/**
 * Coalesces high-frequency streaming deltas before they hit the reducer.
 *
 * The engine can emit dozens of `assistant_delta` / `reasoning_delta` events
 * per second across many stdout ticks; dispatching each one re-renders the
 * whole dynamic region. The batcher merges consecutive deltas of the same
 * (type, turnId) and flushes at most once per frame (~33ms), while strictly
 * preserving event order: any non-delta event forces a flush first.
 */
import type {BridgeEvent} from './protocol.js';

type DeltaEvent = Extract<BridgeEvent, {type: 'assistant_delta' | 'reasoning_delta'}>;

function isDelta(event: BridgeEvent): event is DeltaEvent {
	return event.type === 'assistant_delta' || event.type === 'reasoning_delta';
}

export class DeltaBatcher {
	private pending: DeltaEvent[] = [];
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly emit: (event: BridgeEvent) => void,
		private readonly intervalMs = 33
	) {}

	push(event: BridgeEvent): void {
		if (!isDelta(event)) {
			this.flush();
			this.emit(event);
			return;
		}

		const last = this.pending.at(-1);
		// agentRunId keys subagent deltas — merging across it would splice a child
		// run's text into the parent answer (or vice versa).
		if (
			last &&
			last.type === event.type &&
			last.turnId === event.turnId &&
			(last.agentRunId ?? null) === (event.agentRunId ?? null)
		) {
			last.text += event.text;
		} else {
			this.pending.push({...event});
		}

		this.timer ??= setTimeout(() => this.flush(), this.intervalMs);
	}

	flush(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		if (this.pending.length === 0) return;
		const batch = this.pending;
		this.pending = [];
		for (const event of batch) {
			this.emit(event);
		}
	}

	dispose(): void {
		this.flush();
	}
}
