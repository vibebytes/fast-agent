import type {McpServerRow} from '@fastllm/bridge-client';

export type ServerConfig = {
	transport: 'stdio' | 'remote';
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	autoApprove?: boolean;
	mcpApps?: boolean;
};

export type ServerFormState = {
	transport: 'stdio' | 'remote';
	command: string;
	args: string;
	env: string;
	url: string;
	autoApprove: boolean;
	mcpApps: boolean;
};

/**
 * Fields the dialog does not render but the engine round-trips. A save must send them back:
 * `mcpServerPut` replaces the definition, so dropping them silently clears allowedTools, auth
 * and the rest.
 */
const CARRIED_KEYS = [
	'description',
	'timeout',
	'startupTimeout',
	'allowedTools',
	'blockedTools',
	'sandbox',
	'auth'
] as const;

export function carriedFields(row: McpServerRow | null): Record<string, unknown> {
	if (!row) return {};
	const out: Record<string, unknown> = {};
	for (const key of CARRIED_KEYS) {
		const value = row[key];
		if (value !== undefined && value !== null) out[key] = value;
	}
	return out;
}

export function parseKvLines(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const idx = trimmed.indexOf('=');
		if (idx <= 0) continue;
		out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
	}
	return out;
}

export function mergeServerConfig(
	form: ServerFormState,
	carried: Record<string, unknown> = {}
): ServerConfig {
	if (form.transport === 'remote') {
		// `mcpApps` stays out on purpose: remote servers never open a page in this phase, and a
		// stale `command` from the stdio branch must not survive the switch.
		return {...carried, transport: 'remote', url: form.url.trim(), autoApprove: form.autoApprove};
	}
	return {
		...carried,
		transport: 'stdio',
		command: form.command.trim(),
		args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
		env: parseKvLines(form.env),
		autoApprove: form.autoApprove,
		mcpApps: form.mcpApps
	};
}
