/** TTL for client-origin workspace_file_changed echo suppression after Save. */
export const LOCAL_SAVE_ECHO_TTL_MS = 2_000;

export function localSaveKey(pathHash: string, relativePath: string, mtime: number): string {
	return `${pathHash}|${relativePath}|${mtime}`;
}

/** Record a successful local Save; prunes expired entries. */
export function rememberLocalSave(
	map: Map<string, number>,
	pathHash: string,
	relativePath: string,
	mtime: number,
	now = Date.now(),
	ttlMs = LOCAL_SAVE_ECHO_TTL_MS
): void {
	map.set(localSaveKey(pathHash, relativePath, mtime), now + ttlMs);
	for (const [k, exp] of map) {
		if (exp < now) map.delete(k);
	}
}

export type LocalSaveEchoEvent = {
	origin: string;
	pathHash: string;
	relativePath: string;
	mtime: number;
	connectionId?: string;
};

/**
 * True when a change is our own Save echo.
 * - `client` origin: connectionId match, or recent (pathHash|path|mtime) TTL.
 * - `watch` origin: TTL only (engine usually suppresses; Hub is defense in depth).
 * - `agent` origin: never suppressed.
 */
export function isLocalSaveEcho(
	map: Map<string, number>,
	event: LocalSaveEchoEvent,
	bridgeConnectionId: string | null | undefined,
	now = Date.now()
): {suppress: boolean; learnConnectionId?: string} {
	if (event.origin === 'agent') return {suppress: false};
	if (
		event.origin === 'client' &&
		bridgeConnectionId &&
		event.connectionId === bridgeConnectionId
	) {
		return {suppress: true};
	}
	const key = localSaveKey(event.pathHash, event.relativePath, event.mtime);
	const exp = map.get(key);
	if (exp != null && exp >= now) {
		return {
			suppress: true,
			...(event.origin === 'client' && event.connectionId
				? {learnConnectionId: event.connectionId}
				: {})
		};
	}
	return {suppress: false};
}
