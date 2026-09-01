import {appendFileSync, mkdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Machine-local CLI log (host protocol ACKs, diagnostics). Not shown in the TUI transcript. */
export function cliLogPath(): string {
	return path.join(os.homedir(), '.fast', 'logs', 'cli.log');
}

export function appendCliLog(line: string, file = cliLogPath()): void {
	const text = line.trimEnd();
	if (text.length === 0) return;
	try {
		mkdirSync(path.dirname(file), {recursive: true});
		appendFileSync(file, `${new Date().toISOString()} ${text}\n`, 'utf8');
	} catch {
		// Logging must never break the TUI.
	}
}

export function logHostCommandResult(opts: {
	name: string;
	status?: string;
	message?: string;
}): void {
	const status = opts.status ?? 'success';
	const msg = (opts.message ?? '').replace(/\s+/g, ' ').trim();
	const clipped = msg.length > 240 ? `${msg.slice(0, 240)}…` : msg;
	appendCliLog(`command_result name=${opts.name} status=${status}${clipped ? ` ${clipped}` : ''}`);
}
