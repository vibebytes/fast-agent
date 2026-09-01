/**
 * Bridge / model payloads sometimes wrap shell results as:
 *
 * ```
 * <tool_result name="shell" success="true">
 * output: …
 * summary: …
 * </tool_result>
 * ```
 *
 * Prefer the `output:` field, then `summary:`, then the inner body.
 * Status comes from exit code / Bridge success / structured tool_result attrs —
 * never from free-form log text.
 */
const JSON_OUTPUT_FIELDS = [
	'outputPreview',
	'output',
	'stdout',
	'stderr',
	'summary',
	'error',
	'message'
] as const;

/**
 * Safely parse JSON strings, handling unescaped control characters (such as
 * literal newlines inside string values) by escaping them before parsing.
 */
function tryParseJsonObject(str: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(str);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Continue to sanitization / completion fallbacks below
	}

	// Escape literal unescaped control chars (0x00-0x1F) inside string literals
	try {
		const sanitized = str.replace(/"(?:[^"\\]|\\.)*"/g, match =>
			match.replace(/[\u0000-\u001F]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
		);
		const parsed = JSON.parse(sanitized);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Continue to completion fallback
	}

	return null;
}

/**
 * Safely parse JSON strings (including streaming / truncated payloads and
 * strings with unescaped control characters) using standard JSON.parse.
 */
function parseJsonLenient(text: string): Record<string, unknown> | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

	// Try as-is, or by completing unclosed string quotes / object braces for truncated streams.
	const attempts = [
		trimmed,
		`${trimmed}"}`,
		`${trimmed}"`,
		`${trimmed}}`
	];

	for (const candidate of attempts) {
		const parsed = tryParseJsonObject(candidate);
		if (parsed) return parsed;
	}

	return null;
}

function parsedJsonOutput(parsed: Record<string, unknown>): string | null {
	for (const field of JSON_OUTPUT_FIELDS) {
		const value = parsed[field];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return null;
}

function tryUnwrapJson(str: string): string {
	const parsed = parseJsonLenient(str);
	if (parsed) {
		const output = parsedJsonOutput(parsed);
		if (output) return output;
	}
	return str;
}

function unescapeLiteralNewlines(str: string): string {
	if (str.includes('\\n') && !str.includes('\n')) {
		return str.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
	}
	return str;
}

export function normalizeToolOutput(raw: string | undefined | null): string {
	if (raw == null) return '';
	let text = raw.replace(/^\uFEFF/, '').trim();
	if (!text) return '';

	text = tryUnwrapJson(text);

	const wrapped = /<tool_result\b[^>]*>([\s\S]*?)<\/tool_result>/i.exec(text);
	let body = (wrapped?.[1] ?? text).trim();

	// Unclosed tag while streaming — strip opening tag and keep rest.
	if (!wrapped && /<tool_result\b/i.test(body)) {
		body = body.replace(/<tool_result\b[^>]*>/i, '').trim();
	}
	body = body.replace(/<\/tool_result>/gi, '').trim();

	body = tryUnwrapJson(body);

	const outputField = /(?:^|\n)\s*output:\s*([\s\S]*?)(?=\n\s*(?:summary|error|stderr|stdout)\s*:|$)/i.exec(
		body
	);
	let result = body.trim();
	if (outputField?.[1]?.trim()) {
		result = outputField[1].trim();
	} else {
		// Failed payloads often use `error: …` instead of output.
		const errorField = /(?:^|\n)\s*error:\s*([\s\S]*?)(?=\n\s*(?:summary|output|stderr|stdout)\s*:|$)/i.exec(
			body
		);
		if (errorField?.[1]?.trim()) {
			const err = errorField[1].trim();
			// Drop structured `exit=N` prefix lines from display.
			const withoutExit = err.replace(/^exit=\d+\s*/i, '').trim();
			if (withoutExit) result = withoutExit;
			else if (!/^exit[=:\s]*\d+\s*$/i.test(err)) result = err;
		} else {
			const summaryField = /(?:^|\n)\s*summary:\s*([\s\S]*?)$/i.exec(body);
			if (summaryField?.[1]?.trim()) {
				result = summaryField[1].trim();
			} else {
				const stdoutField = /(?:^|\n)\s*stdout:\s*([\s\S]*?)(?=\n\s*(?:stderr|summary|output)\s*:|$)/i.exec(
					body
				);
				if (stdoutField?.[1]?.trim()) result = stdoutField[1].trim();
			}
		}
	}

	result = tryUnwrapJson(result);
	return unescapeLiteralNewlines(result);
}

/** `<tool_result success="…">` attribute (engine observation metadata). */
export function toolResultSuccessAttr(raw: string | undefined | null): boolean | undefined {
	if (raw == null) return undefined;
	const match = /<tool_result\b[^>]*\bsuccess\s*=\s*["']?(true|false)["']?/i.exec(raw);
	if (!match?.[1]) return undefined;
	return match[1].toLowerCase() === 'true';
}

/**
 * Resolve process exit code from Bridge `fields` (preferred) or structured
 * tool_result metadata (`error: exit=127`, leading `exit=N`, attribute).
 */
export function parseExitCode(
	fields?: Record<string, string> | null,
	raw?: string | null
): number | undefined {
	const fromFields = fields?.exit ?? fields?.exit_code ?? fields?.exitCode;
	if (fromFields != null && String(fromFields).trim() !== '') {
		const n = Number(String(fromFields).trim());
		if (Number.isFinite(n)) return n;
	}

	if (!raw) return undefined;

	const jsonParsed = parseJsonLenient(raw);
	if (jsonParsed) {
		const code = jsonParsed.exitCode ?? jsonParsed.exit ?? jsonParsed.exit_code;
		if (code != null && String(code).trim() !== '') {
			const n = Number(String(code).trim());
			if (Number.isFinite(n)) return n;
		}
	}

	const errExit = /(?:^|\n)\s*error:\s*exit[=:\s]+(\d+)\b/i.exec(raw);
	if (errExit?.[1]) {
		const n = Number(errExit[1]);
		if (Number.isFinite(n)) return n;
	}

	// Failed shell body often starts with `exit=N\n…` inside error: or raw.
	const leadingExit = /(?:^|\n)\s*exit=(\d+)\b/i.exec(raw);
	if (leadingExit?.[1]) {
		const n = Number(leadingExit[1]);
		if (Number.isFinite(n)) return n;
	}

	const attr = /<tool_result\b[^>]*\bexit(?:_code)?\s*=\s*["']?(\d+)/i.exec(raw);
	if (attr?.[1]) {
		const n = Number(attr[1]);
		if (Number.isFinite(n)) return n;
	}

	return undefined;
}

/**
 * Resolve status priority:
 * 1. exit code (fields / structured tool_result)
 * 2. Bridge fields.status / event.success
 * 3. tool_result success="…" attribute
 */
export function resolveToolStatus(options: {
	eventSuccess?: boolean;
	fields?: Record<string, string> | null;
	raw?: string | null;
	fallback?: 'running' | 'success' | 'error' | 'cancelled';
}): 'running' | 'success' | 'error' | 'cancelled' {
	const exit = parseExitCode(options.fields, options.raw);
	if (exit !== undefined) return exit === 0 ? 'success' : 'error';

	const fieldStatus = options.fields?.status?.trim().toLowerCase();
	if (fieldStatus === 'failed' || fieldStatus === 'rejected' || fieldStatus === 'error') {
		return 'error';
	}
	if (fieldStatus === 'success' || fieldStatus === 'ok') return 'success';

	if (options.eventSuccess === false) return 'error';

	const xmlOk = toolResultSuccessAttr(options.raw);
	if (xmlOk === false) return 'error';

	if (options.eventSuccess === true || xmlOk === true) return 'success';
	return options.fallback ?? 'success';
}
