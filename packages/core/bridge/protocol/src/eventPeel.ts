/** Terminal events whose loss leaves Composer permanently busy. */
export const TERMINAL_EVENT_TYPES = new Set([
	'turn_finished',
	'turn_cancelled',
	'run_done',
	'run_failed',
	'run_cancelled',
	'run_exhausted'
]);

export const TERMINAL_PARSE_FAILURE_PREFIX = 'terminal event parse failure:';

/** Consecutive Zod failures — host treats this as a notice, not an engine crash. */
export const PROTOCOL_MISMATCH_PREFIX = 'protocol mismatch:';
export const CONSECUTIVE_PARSE_FAIL_NOTICE = 3;

/** Cheap `"type":"X"` peel — never re-parses the (already invalid) JSON. */
export function peelEventType(line: string): string {
	return /"type"\s*:\s*"([^"]*)"/.exec(line)?.[1] ?? '';
}

/** Host should Attach-reconcile when this is set; do not treat as an engine crash. */
export function terminalParseFailure(line: string): string | undefined {
	const type = peelEventType(line);
	if (!TERMINAL_EVENT_TYPES.has(type)) return undefined;
	return `${TERMINAL_PARSE_FAILURE_PREFIX} ${type}`;
}

export function reportInvalidEngineLine(
	line: string,
	emit: {onTerminal: (message: string) => void; onLog?: (message: string) => void}
): void {
	const terminal = terminalParseFailure(line);
	if (terminal) emit.onTerminal(terminal);
	else emit.onLog?.(`Invalid engine event: ${line}`);
}
