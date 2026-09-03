/** Optimistic user echo for direct submits and queue interrupts (perf doc P2-15).
 *  The bubble lives outside the store; it retires when the engine's real user
 *  entry lands. Reflection is decided by a count baseline, not existence —
 *  resending identical text must not match an older entry.
 *
 *  A late turn_started must still replace the ghost (P1-4), so the fallback TTL
 *  is wide. It only exists so slash rewrites / inputRejected / send failures —
 *  cases that never emit a matching user row — cannot pin a bubble forever. */
export const ECHO_FALLBACK_TTL_MS = 45_000;

export type QueueEcho = {
	taskId: string | null;
	text: string;
	at: number;
	expiresAt: number;
	/** Matching user entries already in the timeline when the echo was created. */
	baseline: number;
};

export function countUserMatches(items: readonly {kind: string; text?: string}[], text: string): number {
	let n = 0;
	for (const item of items) {
		if (item.kind === 'user' && item.text === text) n++;
	}
	return n;
}

export function makeQueueEcho(
	taskId: string | null,
	text: string,
	items: readonly {kind: string; text?: string}[],
	now = Date.now(),
	ttlMs = ECHO_FALLBACK_TTL_MS
): QueueEcho {
	return {
		taskId,
		text,
		at: now,
		expiresAt: now + ttlMs,
		baseline: countUserMatches(items, text)
	};
}

export function isEchoReflected(
	echo: QueueEcho | null,
	items: readonly {kind: string; text?: string}[]
): boolean {
	return echo != null && countUserMatches(items, echo.text) > echo.baseline;
}

export function isEchoExpired(echo: QueueEcho | null, now = Date.now()): boolean {
	return echo != null && now >= echo.expiresAt;
}
