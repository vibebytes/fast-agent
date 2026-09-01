import type {BridgeCommand} from '@fastllm/bridge-protocol';

/**
 * SkillSlash / host slash share Bridge `{type:command}`.
 * Without `sessionId`, Engine uses stale focus (often boot) → stream demux misses the
 * active Task → UI looks completely dead. Thin Clients must always pin.
 */
export function isSkillSlashBridgeCommand(cmd: BridgeCommand): cmd is Extract<
	BridgeCommand,
	{type: 'command'}
> {
	return cmd.type === 'command';
}

/** True when a `{type:command}` is safe for multi-Attach SkillSlash demux. */
export function commandPinsSession(cmd: BridgeCommand): boolean {
	return (
		cmd.type === 'command' &&
		typeof cmd.sessionId === 'string' &&
		cmd.sessionId.trim().length > 0
	);
}

/**
 * Contract for tests + send path: every SkillSlash-bound command must pin a session.
 * Throws with a stable message so CI failure is obvious.
 */
export function assertSkillCommandPinned(
	cmd: BridgeCommand,
	expectedSessionId?: string
): asserts cmd is Extract<BridgeCommand, {type: 'command'}> & {sessionId: string} {
	if (!isSkillSlashBridgeCommand(cmd)) {
		throw new Error(`expected type=command, got ${cmd.type}`);
	}
	if (!commandPinsSession(cmd)) {
		throw new Error(
			`SkillSlash contract violated: command "${cmd.name}" missing sessionId ` +
				`(Engine would use boot/stale focus → silent UI)`
		);
	}
	if (expectedSessionId != null && cmd.sessionId !== expectedSessionId) {
		throw new Error(
			`SkillSlash contract violated: sessionId=${cmd.sessionId} want ${expectedSessionId}`
		);
	}
}
