import type {EngineRow} from '@fastllm/bridge-client';

/** Settings administers lifecycle. Conversation switch is Composer `SetEngine`. */
export const ENGINE_SETTINGS_ACTIONS = [
	'enable',
	'disable',
	'start',
	'stop',
	'install',
	'uninstall',
	'cancel'
] as const;

export type EngineSettingsAction = (typeof ENGINE_SETTINGS_ACTIONS)[number];

export function isEngineAvailable(
	entry: Pick<EngineRow, 'kind' | 'adapter' | 'program'>
): boolean {
	if (entry.kind === 'builtin') return true;
	return entry.adapter === 'ready' && entry.program !== 'missing' && entry.program !== 'installing';
}

/** Registry default is display-only. `SetDefaultEngine` is rejected by the host. */
export function engineSettingsRowClick(): 'ignore' {
	return 'ignore';
}
