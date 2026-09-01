import {isLiveChrome, PERSIST_RIVER_TYPES, type BridgeEvent} from '@fastllm/bridge-protocol';

/** Sequenced text must not paint across a Fast seq hole (验收 3 / 6). */
const HOLD_THROUGH_HOLE = new Set(['assistant_delta', 'reasoning_delta', 'final_answer']);

/** Success settle: emit held prose first so `postRunTerminal` cannot drop it. */
const SETTLE_FLUSH = new Set(['turn_finished', 'run_done', 'run_failed', 'run_exhausted']);

/** Cancel settle: drop held prose; Stop still goes out. */
const SETTLE_DROP = new Set(['turn_cancelled', 'run_cancelled']);

const FLUSHABLE = new Set(['assistant_delta', 'reasoning_delta', 'final_answer', 'seq_skip']);

export type SessionSeq = {
	lastApplied: number;
	pending: Map<number, BridgeEvent>;
	syncing: boolean;
	/** Last sequenced text turn. A later turn must not inherit an unfilled hole. */
	lastTurnId?: string;
	/**
	 * Seq-layer copy of the chat document slot (`lastDocumentId` on the transcript).
	 * Bind unkeyed persist prose here so a cancelled opener cannot inherit it.
	 */
	liveTurnId?: string;
	/** Cold `session_restored` painted history but never stamped the river cursor. */
	restored?: boolean;
};

export type OfferCtx = {
	/** True when the round already ended (see `seqTerminal`). */
	terminal?: boolean;
};

/** ① only after a settled assistant. No assistant yet is still live. */
export function seqTerminal(t: {
	postRunTerminal?: boolean;
	entries: ReadonlyArray<{role: string; status?: string}>;
}): boolean {
	if (t.postRunTerminal) return true;
	const assistants = t.entries.filter(e => e.role === 'assistant');
	return assistants.length > 0 && !assistants.some(e => e.status === 'streaming');
}

export type OfferResult = {
	state: SessionSeq;
	emit: BridgeEvent[];
	resync: boolean;
};

export function emptySessionSeq(): SessionSeq {
	return {lastApplied: 0, pending: new Map(), syncing: false};
}

export function eventSeqOf(event: BridgeEvent): number | undefined {
	return typeof event.eventSeq === 'number' && Number.isSafeInteger(event.eventSeq) && event.eventSeq > 0
		? event.eventSeq
		: undefined;
}

export function unitIdOf(event: BridgeEvent): string | undefined {
	if ('unitId' in event && typeof event.unitId === 'string') {
		const id = event.unitId.trim();
		if (id) return id;
	}
	return undefined;
}

export function offer(state: SessionSeq, event: BridgeEvent, ctx: OfferCtx = {}): OfferResult {
	if (event.type === 'gap') return onGap(state, event, ctx);
	const seq = eventSeqOf(event);
	if (seq == null) {
		if (event.type === 'session_restored')
			return {
				state: state.lastApplied === 0 ? {...state, restored: true} : state,
				emit: [event],
				resync: false
			};
		if (PERSIST_RIVER_TYPES.has(event.type) && !isLiveChrome(event))
			return {state, emit: [], resync: false};
		if (SETTLE_DROP.has(event.type)) return dropHeld(state, event);
		if (SETTLE_FLUSH.has(event.type)) return flushHeld(state, event);
		return {state: rememberTurn(state, event), emit: [event], resync: false};
	}
	if (event.type === 'checkpoint' && canSeal(state, event, seq)) return seal(state, event, seq);
	if (seq <= state.lastApplied) return {state, emit: [], resync: false};
	if (seq === state.lastApplied + 1) {
		if (SETTLE_FLUSH.has(event.type) && flushableHeld(state, event).length > 0)
			return flushHeld(state, event);
		return drain({
			state: commit(state, event, seq),
			emit: visible(event) ? [event] : [],
			resync: false
		});
	}
	if (HOLD_THROUGH_HOLE.has(event.type)) {
		if (shouldJumpHole(state, event, ctx)) {
			return drain({
				state: commit(align(state, seq - 1), event, seq),
				emit: visible(event) ? [event] : [],
				resync: false
			});
		}
		const pending = new Map(state.pending);
		pending.set(seq, bindHeld(state, event));
		return {
			state: {
				...state,
				pending,
				syncing: true,
				lastTurnId: turnIdOf(event) ?? state.lastTurnId
			},
			emit: [],
			resync: !state.syncing
		};
	}
	// Cards / settle still paint when Engine skipped a no-UI EventRow (seq_skip
	// should fill those holes; this is the remaining UX exception).
	if (isLiveChrome(event)) {
		if (SETTLE_DROP.has(event.type)) return dropHeld(state, event);
		if (SETTLE_FLUSH.has(event.type) && flushableHeld(state, event).length > 0)
			return flushHeld(state, event);
		return {
			state: rememberTurn({...state, syncing: true}, event),
			emit: [event],
			resync: !state.syncing
		};
	}
	const pending = new Map(state.pending);
	pending.set(seq, event);
	return {state: {...state, pending, syncing: true}, emit: [], resync: !state.syncing};
}

function onGap(state: SessionSeq, event: BridgeEvent, ctx: OfferCtx): OfferResult {
	if (ctx.terminal) return patchTerminal(state, event);
	const covering = coveringCheckpoint(state);
	if (covering) return seal(state, covering.event, covering.seq);
	return {state: {...state, syncing: true}, emit: [event], resync: !state.syncing};
}

/** ① 已见终态：跳到窗口已确认最大 Fast seq，整页 restore，不上 streamIncomplete. */
function patchTerminal(state: SessionSeq, event: BridgeEvent): OfferResult {
	const high = highOf(event);
	return {
		state: {
			...state,
			lastApplied: Math.max(state.lastApplied, high),
			pending: new Map(),
			syncing: false,
			restored: false
		},
		emit: [],
		resync: true
	};
}

function turnIdOf(event: BridgeEvent): string | undefined {
	if ('turnId' in event && typeof event.turnId === 'string' && event.turnId) return event.turnId;
	return undefined;
}

function settleKeyOf(event: BridgeEvent): string | undefined {
	const turnId = turnIdOf(event);
	if (turnId) return turnId;
	if ('runId' in event && typeof event.runId === 'string' && event.runId) return event.runId;
	return undefined;
}

function matchesSettleTurn(
	event: BridgeEvent,
	settleTurn: string | undefined,
	lastTurnId?: string
): boolean {
	if (!settleTurn) return true;
	const key = settleKeyOf(event);
	if (key) return key === settleTurn;
	// Persist poll-thread deltas often have no turnId. Bind them to the live
	// chat turn (or last committed) so run-level settle still flushes the body.
	if (event.type === 'seq_skip') return true;
	const bound = lastTurnId;
	return !bound || bound === settleTurn;
}

function bindTurnId(state: SessionSeq): string | undefined {
	return state.liveTurnId ?? state.lastTurnId;
}

/** Stamp the live chat turn onto held prose so a cancelled opener cannot steal it. */
function bindHeld(state: SessionSeq, event: BridgeEvent): BridgeEvent {
	const id = bindTurnId(state);
	if (turnIdOf(event) || !id) return event;
	return {...event, turnId: id} as BridgeEvent;
}

/** Live chrome / hole-paint owns the chat turn without moving the seq cursor. */
function rememberTurn(state: SessionSeq, event: BridgeEvent): SessionSeq {
	if (SETTLE_DROP.has(event.type)) return forgetTurn(state, event);
	const id = turnIdOf(event);
	return id ? {...state, liveTurnId: id} : state;
}

function forgetTurn(state: SessionSeq, event: BridgeEvent): SessionSeq {
	const key = settleKeyOf(event);
	if (!key) return state;
	return {
		...state,
		lastTurnId: state.lastTurnId === key ? undefined : state.lastTurnId,
		liveTurnId: state.liveTurnId === key ? undefined : state.liveTurnId
	};
}

function flushableHeld(state: SessionSeq, settle: BridgeEvent): Array<[number, BridgeEvent]> {
	const settleTurn = settleKeyOf(settle);
	return [...state.pending.entries()]
		.filter(([, ev]) => FLUSHABLE.has(ev.type) && matchesSettleTurn(ev, settleTurn, bindTurnId(state)))
		.sort((a, b) => a[0] - b[0]);
}

function dropHeld(state: SessionSeq, settle: BridgeEvent): OfferResult {
	const drop = new Set(flushableHeld(state, settle).map(([seq]) => seq));
	const pending = new Map([...state.pending].filter(([seq]) => !drop.has(seq)));
	return {
		state: forgetTurn({...state, pending, syncing: pending.size > 0}, settle),
		emit: [settle],
		resync: false
	};
}

/** Emit held text in seq order, then the settle event. Do not use `run_done.eventSeq` to jump. */
function flushHeld(state: SessionSeq, settle: BridgeEvent): OfferResult {
	const held = flushableHeld(state, settle);
	if (held.length === 0) return {state, emit: [settle], resync: false};
	const pending = new Map(state.pending);
	for (const [seq] of held) pending.delete(seq);
	let next: SessionSeq = {...state, pending, restored: false};
	const seed = [...held].reverse().find(([, ev]) => ev.type === 'final_answer' && seedText(ev).length > 0);
	const emit: BridgeEvent[] = [];
	for (const [seq, ev] of held) {
		if (seq > next.lastApplied) next = commit(next, ev, seq);
		if (seed) {
			if (ev === seed[1]) emit.push(ev);
			continue;
		}
		if (visible(ev)) emit.push(ev);
	}
	const drained = drain({state: next, emit, resync: false});
	return {
		state: {...drained.state, syncing: drained.state.pending.size > 0},
		emit: [...drained.emit, settle],
		resync: false
	};
}

/** One unfilled hole must not freeze every later turn in this UI session. */
function shouldJumpHole(state: SessionSeq, event: BridgeEvent, ctx: OfferCtx): boolean {
	if (state.restored) return true;
	if (ctx.terminal) return true;
	const turnId = turnIdOf(event);
	return Boolean(turnId && state.lastTurnId && turnId !== state.lastTurnId);
}

function align(state: SessionSeq, lastApplied: number): SessionSeq {
	return {...state, lastApplied, pending: new Map(), syncing: false, restored: false};
}

function highOf(event: BridgeEvent): number {
	if (event.type !== 'gap') return 0;
	const high = typeof event.high === 'number' && Number.isSafeInteger(event.high) && event.high > 0
		? event.high
		: event.floor;
	return high;
}

function coveringCheckpoint(state: SessionSeq): {event: BridgeEvent; seq: number} | undefined {
	const found = [...state.pending.entries()]
		.filter(([, ev]) => ev.type === 'checkpoint')
		.sort((a, b) => a[0] - b[0]);
	for (const [seq, event] of found) {
		if (canSeal(state, event, seq)) return {event, seq};
	}
	return undefined;
}

function canSeal(state: SessionSeq, event: BridgeEvent, seq: number): boolean {
	if (event.type !== 'checkpoint') return false;
	const unit = unitIdOf(event);
	if (!unit || seq <= state.lastApplied) return false;
	for (let n = state.lastApplied + 1; n < seq; n++) {
		const held = state.pending.get(n);
		if (!held) continue;
		if (unitIdOf(held) != null && unitIdOf(held) !== unit) return false;
	}
	return true;
}

function seal(state: SessionSeq, event: BridgeEvent, seq: number): OfferResult {
	const unit = unitIdOf(event);
	const pending = new Map(state.pending);
	pending.delete(seq);
	for (const [n, held] of [...pending]) {
		if (n <= seq && unit && unitIdOf(held) === unit) pending.delete(n);
	}
	return drain({
		state: {
			...state,
			lastApplied: seq,
			pending,
			syncing: state.syncing,
			restored: false,
			lastTurnId: turnIdOf(event) ?? state.lastTurnId
		},
		emit: [event],
		resync: false
	});
}

function commit(state: SessionSeq, event: BridgeEvent, seq: number): SessionSeq {
	const pending = new Map(state.pending);
	pending.delete(seq);
	return {
		...state,
		lastApplied: seq,
		pending,
		syncing: state.syncing,
		restored: false,
		lastTurnId: turnIdOf(event) ?? state.lastTurnId
	};
}

function drain(result: OfferResult): OfferResult {
	let {state} = result;
	const emit = [...result.emit];
	while (true) {
		const next = state.pending.get(state.lastApplied + 1);
		if (!next) break;
		state = commit(state, next, state.lastApplied + 1);
		if (visible(next)) emit.push(next);
	}
	const syncing = state.pending.size > 0;
	return {state: {...state, syncing}, emit, resync: result.resync};
}

function visible(event: BridgeEvent): boolean {
	return event.type !== 'seq_skip';
}

function seedText(event: BridgeEvent): string {
	return event.type === 'final_answer' && typeof event.text === 'string' ? event.text.trim() : '';
}
