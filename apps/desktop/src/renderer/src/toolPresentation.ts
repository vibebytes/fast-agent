import {normalizeToolOutput} from '@fast-ide/session-view';

type ToolPresentation = {
	tool: string;
	status: 'running' | 'success' | 'error' | 'cancelled';
	output: string | null;
	summary: string | null;
};

const SKILL_VIEW = 'skill_view';
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function isSkillView(tool: string): boolean {
	return tool.trim().toLowerCase() === SKILL_VIEW;
}

export function isSubagentTool(tool: string): boolean {
	const t = tool.trim().toLowerCase();
	return t === 'call_agent' || t.startsWith('agent: ');
}

export function parseSubagentPayload(raw: string | null | undefined): {
	name?: string;
	prompt?: string;
	tools?: string[];
} {
	if (!raw?.trim()) return {};
	let text = raw.trim();

	// If wrapped in call_agent(...)
	const wrapper = /^call_agent\(([\s\S]*)\)$/i.exec(text);
	if (wrapper?.[1]) text = wrapper[1].trim();

	try {
		const parsed = JSON.parse(text) as Record<string, unknown>;
		let inner = parsed;
		if (typeof parsed.input === 'string') {
			try {
				inner = JSON.parse(parsed.input) as Record<string, unknown>;
			} catch {
				/* ignore */
			}
		}

		const name = typeof inner.name === 'string' ? inner.name : undefined;
		const prompt =
			typeof inner.input === 'string'
				? inner.input
				: typeof inner.prompt === 'string'
					? inner.prompt
					: typeof inner.system_prompt === 'string'
						? inner.system_prompt
						: undefined;
		const tools = Array.isArray(inner.tools) ? inner.tools.map(String) : undefined;

		return {name, prompt, tools};
	} catch {
		return {};
	}
}

export function shouldHideToolItem(item: ToolPresentation): boolean {
	return (
		isSkillView(item.tool) &&
		item.status === 'success' &&
		(item.output?.trim().length ?? 0) === 0
	);
}

function summaryName(summary: string | null): string | null {
	if (!summary?.trim()) return null;
	try {
		const parsed = JSON.parse(summary) as {name?: unknown};
		return typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : null;
	} catch {
		return null;
	}
}

function frontmatterName(output: string | null): string | null {
	const match = output?.match(FRONTMATTER);
	if (!match?.[1]) return null;
	const line = match[1]
		.split(/\r?\n/)
		.find(value => value.trimStart().startsWith('name:'));
	const name = line?.slice(line.indexOf(':') + 1).trim();
	return name || null;
}

export type SkillMeta = {
	name?: string;
	location?: string;
	references?: string;
	resources: string[];
};

export function parseSkillEnvelope(output: string | null): {meta: SkillMeta; body: string} {
	if (!output) return {meta: {resources: []}, body: ''};

	// 1. Primary path: Browser native DOMParser for robust XML DOM parsing
	if (typeof DOMParser !== 'undefined') {
		try {
			const parser = new DOMParser();
			const doc = parser.parseFromString(output, 'text/xml');
			const skillEl = doc.querySelector('skill');
			if (skillEl && !doc.querySelector('parsererror')) {
				const name = skillEl.getAttribute('name') ?? undefined;
				const location = skillEl.getAttribute('location') ?? undefined;

				const resources: string[] = [];
				skillEl.querySelectorAll('available_resources file').forEach(el => {
					const text = el.textContent?.trim();
					if (text) resources.push(text);
				});

				// Clone element to extract body without resource block
				const clone = skillEl.cloneNode(true) as Element;
				clone.querySelector('available_resources')?.remove();

				let rawBody = clone.textContent ?? '';
				rawBody = rawBody.replace(/^References are relative to[^\r\n]*/m, '');
				const body = rawBody.replace(FRONTMATTER, '').trim();

				return {
					meta: {name, location, resources},
					body
				};
			}
		} catch {
			// Fallback to structured parser below if DOMParser is unavailable or fails
		}
	}

	// 2. Fallback path: Clean single-pass structured extraction
	return parseSkillEnvelopeStructured(output);
}

function parseSkillEnvelopeStructured(output: string): {meta: SkillMeta; body: string} {
	const meta: SkillMeta = {resources: []};

	// Extract attributes from <skill ...>
	const skillTag = output.match(/<skill\b([^>]*)>/i);
	if (skillTag) {
		meta.name = skillTag[1].match(/\bname=["']([^"']+)["']/i)?.[1];
		meta.location = skillTag[1].match(/\blocation=["']([^"']+)["']/i)?.[1];
	}

	// Extract resource files from <available_resources>
	const resBlock = output.match(/<available_resources\b[^>]*>([\s\S]*?)<\/available_resources>/i)?.[1];
	if (resBlock) {
		const files = resBlock.match(/<file>([^<]+)<\/file>/gi);
		if (files) {
			meta.resources = files.map(f => f.replace(/<\/?file>/gi, '').trim()).filter(Boolean);
		}
	}

	// Clean body: strip available_resources block, skill tags, references line, and frontmatter
	let body = output
		.replace(/<available_resources\b[^>]*>[\s\S]*?<\/available_resources>/gi, '')
		.replace(/<\/?skill\b[^>]*>/gi, '')
		.replace(/^References are relative to[^\r\n]*/gm, '')
		.trim();

	body = body.replace(FRONTMATTER, '').trim();

	return {meta, body};
}

export function skillViewName(summary: string | null, output: string | null): string | null {
	const parsed = parseSkillEnvelope(output);
	return summaryName(summary) ?? frontmatterName(output) ?? parsed.meta.name ?? null;
}

export function skillViewBody(output: string): string {
	return parseSkillEnvelope(output).body;
}

/** Idempotent renderer seam: also fixes cached pre-normalization TimelineItems after HMR. */
export function displayToolOutput(output: string | null): string {
	return normalizeToolOutput(output);
}

export const TOOL_PREVIEW_LINES = 3;

export type ToolOutputPreview = {lines: string[]; hidden: number};

/** Collapsed cards keep the tail: the last lines of a run carry its verdict. */
export function previewToolOutput(
	output: string | null | undefined,
	maxLines = TOOL_PREVIEW_LINES
): ToolOutputPreview {
	if (!output) return {lines: [], hidden: 0};
	const lines = output.replace(/\n$/, '').split('\n');
	if (lines.length <= maxLines) return {lines, hidden: 0};
	return {lines: lines.slice(-maxLines), hidden: lines.length - maxLines};
}

export type ShellEnvelopeMeta = {
	status: string;
	reason?: string;
	procId?: string;
	exitCode?: number;
	outFile?: string;
	outputPreview?: string;
};

function envelopeString(parsed: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = parsed[key];
		if (typeof value === 'string' && value.trim()) return value;
	}
	return undefined;
}

function envelopeNumber(parsed: Record<string, unknown>, keys: string[]): number | undefined {
	for (const key of keys) {
		const value = parsed[key];
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
			return Number(value);
		}
	}
	return undefined;
}

/**
 * ShellEnvelope JSON (`{status, procId, outFile, outputPreview, exitCode, reason}`)
 * that survived output normalization because `outputPreview` was empty — exactly
 * the payloads a plain text view would otherwise dump as raw JSON. Non-envelope
 * JSON (arbitrary tool results, arrays) returns null and renders as before.
 */
export function parseShellEnvelope(output: string | null | undefined): ShellEnvelopeMeta | null {
	const trimmed = output?.trim();
	// Streamed envelopes may arrive clipped mid-string — completion candidates below
	// close the missing quote/brace, so only the leading `{` is required here.
	if (!trimmed || !trimmed.startsWith('{')) return null;

	let parsed: Record<string, unknown> | null = null;
	const candidates = [trimmed, `${trimmed}"}`, `${trimmed}"`, `${trimmed}}`];
	for (const candidate of candidates) {
		try {
			const value: unknown = JSON.parse(candidate);
			if (value && typeof value === 'object' && !Array.isArray(value)) {
				parsed = value as Record<string, unknown>;
				break;
			}
		} catch {
			// try the next completion candidate
		}
	}
	if (!parsed) return null;

	const status = envelopeString(parsed, ['status']);
	const procId = envelopeString(parsed, ['procId', 'proc_id']);
	const outFile = envelopeString(parsed, ['outFile', 'out_file']);
	const outputPreview = envelopeString(parsed, ['outputPreview', 'output_preview']);
	const reason = envelopeString(parsed, ['reason']);
	const exitCode = envelopeNumber(parsed, ['exitCode', 'exit', 'exit_code']);

	if (!status || (!procId && !outFile && !('outputPreview' in parsed))) return null;

	return {
		status,
		...(reason ? {reason} : {}),
		...(procId ? {procId} : {}),
		...(exitCode !== undefined ? {exitCode} : {}),
		...(outFile ? {outFile} : {}),
		...(outputPreview ? {outputPreview} : {})
	};
}

/** Tail-segment log path for the ribbon chip: `…/terminal/<uuid>.log`. */
export function shortProcLogPath(path: string): string {
	const segments = path.split('/').filter(Boolean);
	if (segments.length <= 1) return path;
	return `…/${segments.slice(-2).join('/')}`;
}

export type ToolOutcome = {
	tone: 'running' | 'success' | 'error' | 'muted';
	label: 'failed' | 'cancelled' | null;
	exitCode: string | null;
};

// Abandonment is a user action, not a fault: engines report it as `Failed(...)`
// but it must not paint the transcript red. Kept narrow so transport faults
// ("connection aborted") still classify as errors.
const USER_ABANDONMENT =
	/user\s+(?:cancel+ed|abort(?:ed)?|declined|rejected)|(?:cancel+ed|abort(?:ed)?|declined|rejected)\s+by\s+user|no answer (?:was )?provided|用户(?:取消|拒绝|中止)|未回答/i;

function toolExitCode(exitCode: string | number | null | undefined): string | null {
	if (exitCode == null || exitCode === '') return null;
	return String(exitCode);
}

export function classifyToolOutcome(input: {
	status: 'running' | 'success' | 'error' | 'cancelled';
	exitCode?: string | number | null;
	output?: string | null;
	summary?: string | null;
}): ToolOutcome {
	const exitCode = toolExitCode(input.exitCode);
	if (input.status === 'running') return {tone: 'running', label: null, exitCode};
	if (input.status === 'cancelled') return {tone: 'muted', label: 'cancelled', exitCode: null};
	if (input.status === 'success') return {tone: 'success', label: null, exitCode};
	const text = `${input.output ?? ''}\n${input.summary ?? ''}`;
	if (USER_ABANDONMENT.test(text)) return {tone: 'muted', label: 'cancelled', exitCode: null};
	return {tone: 'error', label: 'failed', exitCode};
}
