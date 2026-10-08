import {useSyncExternalStore} from 'react';

/** Optimistic stop echo for the composer stop affordance.
 *  The echo lives outside the workspace store; it renders the stopping state
 *  the frame the user clicks — before the IPC roundtrip — and retires when the
 *  terminal event publishes or on a TTL so a failed cancel cannot pin the
 *  button forever. queueEcho.ts (P2-15) is the precedent. */
export const STOP_ECHO_TTL_MS = 15_000;

export type StopEcho = {
	sessionId: string | null;
	runId?: string;
	at: number;
	expiresAt: number;
};

let echo: StopEcho | null = null;
let retireTimer: ReturnType<typeof setTimeout> | undefined;
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
	version++;
	for (const listener of listeners) listener();
}

export function markStopRequested(
	sessionId: string | null,
	runId?: string,
	now = Date.now(),
	ttlMs = STOP_ECHO_TTL_MS
): StopEcho {
	echo = {sessionId, runId, at: now, expiresAt: now + ttlMs};
	if (retireTimer !== undefined) clearTimeout(retireTimer);
	retireTimer = setTimeout(() => {
		retireTimer = undefined;
		if (echo && Date.now() >= echo.expiresAt) {
			echo = null;
			emit();
		}
	}, ttlMs);
	emit();
	trace('cancel.click', {sessionId, runId});
	return echo;
}

/** Echo only what the main process actually dispatched; a guarded no-op must not look like a stop in flight. */
export async function requestStop(
	sessionId: string | null,
	dispatch: () => Promise<boolean>
): Promise<boolean> {
	const sent = await dispatch();
	if (sent) markStopRequested(sessionId);
	return sent;
}

export function activeStopEcho(sessionId: string | null, now = Date.now()): StopEcho | null {
	if (!echo || now >= echo.expiresAt) return null;
	if (echo.sessionId != null && sessionId != null && echo.sessionId !== sessionId) return null;
	return echo;
}

export function settleStopEcho(sessionId: string | null, now = Date.now()): boolean {
	if (!echo) return false;
	if (echo.sessionId != null && sessionId != null && echo.sessionId !== sessionId) return false;
	const ms = now - echo.at;
	echo = null;
	if (retireTimer !== undefined) {
		clearTimeout(retireTimer);
		retireTimer = undefined;
	}
	emit();
	trace('cancel.settled', {ms});
	return true;
}

export function subscribeStopEcho(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useStopEcho(sessionId: string | null): boolean {
	const snapshot = useSyncExternalStore(
		subscribeStopEcho,
		() => (activeStopEcho(sessionId) ? `on:${version}` : `off:${version}`),
		() => 'off'
	);
	return snapshot.startsWith('on');
}

function trace(event: string, data: Record<string, unknown>): void {
	if (typeof localStorage === 'undefined' || localStorage.getItem('fastIde.trace') !== '1') return;
	console.debug('[fast-ide perf]', event, data);
}
