export type Phase = 'waiting' | 'handshaking' | 'ready' | 'rejected' | 'timeout';

export type PhaseEvent =
	| {kind: 'url'; hasUrl: boolean}
	| {kind: 'page.ready'; accepted: boolean}
	| {kind: 'timeout'}
	| {kind: 'retry'};

/**
 * Handshake state machine. Kept pure so the transitions are testable without a DOM: the component
 * only maps the returned phase onto state.
 */
export function nextPhase(phase: Phase, ev: PhaseEvent): Phase {
	switch (ev.kind) {
		case 'url':
			return ev.hasUrl ? 'handshaking' : 'waiting';
		case 'retry':
			return 'handshaking';
		case 'timeout':
			return phase === 'handshaking' ? 'timeout' : phase;
		case 'page.ready':
			return ev.accepted ? 'ready' : 'rejected';
	}
}

/** A late `surface.ready` must still be able to rescue a timed-out panel. */
export function canAcceptReady(phase: Phase): boolean {
	return phase === 'handshaking' || phase === 'timeout';
}
