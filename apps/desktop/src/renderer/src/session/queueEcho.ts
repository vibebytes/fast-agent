/** Optimistic user echo for direct submits and queue interrupts (perf doc P2-15).
 *  The bubble lives outside the store; it retires when the engine's real user
 *  entry lands. Reflection is decided by a count baseline, not existence —
 *  resending identical text must not match an older entry. */
export type QueueEcho = {
	taskId: string | null;
	text: string;
	at: number;
	/** How long to keep the bubble if the engine never echoes it back. */
	ttl?: number;
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
	ttl?: number
): QueueEcho {
	return {
		taskId,
		text,
		at: Date.now(),
		baseline: countUserMatches(items, text),
		...(ttl ? {ttl} : {})
	};
}

export function isEchoReflected(
	echo: QueueEcho | null,
	items: readonly {kind: string; text?: string}[]
): boolean {
	return echo != null && countUserMatches(items, echo.text) > echo.baseline;
}
