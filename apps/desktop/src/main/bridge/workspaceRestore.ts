/**
 * Workspace Restore — cold-start from Meta `workspace_meta` only.
 *
 * Electron userData prefs (`workspace.json`) are not used: open set authority is Engine Meta.
 * Hub.applyWorkspaceMeta opens/hydrates; this reducer boots Engine, arms timeout, then
 * publishes UI + explicit restored/failed signals (landing gate).
 */

/** Cold start can exceed 60s when ~/.fast/server/runtime.mv.db is large. */
export const RESTORE_TIMEOUT_MS = 180_000;

export type WorkspaceRestoreState = {
	/** True after first success or failure — shell may mount. */
	done: boolean;
	failed: boolean;
	reason?: string;
};

export type WorkspaceRestoreEvent =
	| {type: 'start'}
	| {type: 'metaApplied'}
	| {type: 'timeout'}
	| {type: 'engineFailed'; message: string};

export type WorkspaceRestoreCommand =
	| {type: 'ensureEngine'}
	| {type: 'armTimeout'; ms: number}
	| {type: 'clearTimeout'}
	| {type: 'publishRestored'}
	| {type: 'publishFailed'; reason: string};

export function initialWorkspaceRestoreState(): WorkspaceRestoreState {
	return {done: false, failed: false};
}

export function reduceWorkspaceRestore(
	state: WorkspaceRestoreState,
	event: WorkspaceRestoreEvent
): {state: WorkspaceRestoreState; commands: WorkspaceRestoreCommand[]} {
	switch (event.type) {
		case 'start':
			return {
				state: {done: false, failed: false},
				commands: [
					{type: 'ensureEngine'},
					{type: 'armTimeout', ms: RESTORE_TIMEOUT_MS}
				]
			};

		case 'metaApplied':
			return {
				state: {done: true, failed: false},
				commands: [{type: 'clearTimeout'}, {type: 'publishRestored'}]
			};

		case 'timeout':
			if (state.done) return {state, commands: []};
			return {
				state: {done: true, failed: true, reason: 'Engine startup timed out'},
				commands: [
					{type: 'clearTimeout'},
					{type: 'publishFailed', reason: 'Engine startup timed out'}
				]
			};

		case 'engineFailed':
			if (state.done) return {state, commands: []};
			{
				const reason = event.message.trim() || 'Engine error';
				return {
					state: {done: true, failed: true, reason},
					commands: [
						{type: 'clearTimeout'},
						{
							type: 'publishFailed',
							reason
						}
					]
				};
			}
	}
}
