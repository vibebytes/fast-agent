/**
 * Pure gate: cold-start landing until restored/failed signal.
 */
export type ShellGatePhase = 'landing' | 'shell';

export type ShellGateEvent =
	| {type: 'workspace:restored'}
	| {type: 'workspace:restoreFailed'; reason: string};

export function reduceShellGate(
	phase: ShellGatePhase,
	event: ShellGateEvent
): ShellGatePhase {
	if (phase === 'shell') return phase;
	if (event.type === 'workspace:restored' || event.type === 'workspace:restoreFailed') {
		return 'shell';
	}
	return phase;
}

/** Overlay when Engine is unavailable after shell is mounted. */
export function engineOverlayVisible(
	status: string | null | undefined
): boolean {
	return status === 'reconnecting' || status === 'exited' || status === 'error';
}

export type EngineOverlay = {
	visible: boolean;
	/** Full-window modal would lock sidebar / status. Pane overlay must not. */
	lockChrome: boolean;
	showRetry: boolean;
};

/** Pane-scoped overlay: same for local and remote. Chrome stays clickable. */
export function engineOverlay(status: string | null | undefined): EngineOverlay {
	const visible = engineOverlayVisible(status);
	return {
		visible,
		lockChrome: false,
		showRetry: visible && (status === 'error' || status === 'exited')
	};
}
