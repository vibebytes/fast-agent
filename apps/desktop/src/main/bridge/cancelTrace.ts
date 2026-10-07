/** Cancel fastlane trace: dispatch → terminal per session.
 *  Off unless FLOW_PERF_TRACE=1. Entries expire after a minute of silence so a
 *  lost terminal event cannot leak the map. */
const TTL_MS = 60_000;

const pending = new Map<string, number>();
let enabled = process.env.FLOW_PERF_TRACE === '1';

export function setCancelTraceEnabled(on: boolean): void {
	enabled = on;
	if (!enabled) pending.clear();
}

export function markCancelDispatch(sessionId: string, now = Date.now()): void {
	if (!enabled || !sessionId) return;
	pending.set(sessionId, now);
}

export function markCancelTerminal(sessionId: string, kind: string, now = Date.now()): void {
	if (!enabled || !sessionId) return;
	const at = pending.get(sessionId);
	if (at === undefined) return;
	pending.delete(sessionId);
	console.info(`[flow-perf] cancel ${sessionId} ${kind} +${(now - at).toFixed(1)}ms since dispatch`);
}

export function expiredCancelTraces(now = Date.now()): string[] {
	const stale: string[] = [];
	for (const [sessionId, at] of pending) {
		if (now - at > TTL_MS) stale.push(sessionId);
	}
	for (const sessionId of stale) pending.delete(sessionId);
	return stale;
}
