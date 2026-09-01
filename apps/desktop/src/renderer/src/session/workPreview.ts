import {normalizeToolOutput, toolResultSuccessAttr} from '@fast-ide/session-view';

export type StructuredWorkPreview = {
	tool?: string;
	success?: boolean;
	status?: string;
	exitCode?: number;
	outFile?: string;
	procId?: string;
	/** Cleaned human-readable body (no tool_result / JSON envelope). */
	body: string;
	/** One-line summary for drawer chrome. */
	headline: string;
};

function lastToolResultChunk(raw: string): string {
	const closed = [...raw.matchAll(/<tool_result\b[\s\S]*?<\/tool_result>/gi)];
	if (closed.length > 0) return closed[closed.length - 1]![0]!;
	const open = raw.lastIndexOf('<tool_result');
	if (open >= 0) return raw.slice(open);
	const m = /(?:^|[\s>])tool_result\b[^>]*>/i.exec(raw);
	if (m && m.index != null) {
		const start = raw[m.index] === 't' ? m.index : m.index + 1;
		return `<${raw.slice(start)}`;
	}
	if (/^tool_result\b/i.test(raw)) return `<${raw}`;
	return raw;
}

function toolNameAttr(chunk: string): string | undefined {
	const m = /(?:<)?tool_result\b[^>]*\bname\s*=\s*["']?([^"'\s>]+)/i.exec(chunk);
	return m?.[1]?.trim() || undefined;
}

function stringField(raw: string, key: string): string | undefined {
	const m = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i').exec(raw);
	if (!m?.[1]) return undefined;
	try {
		return JSON.parse(`"${m[1]}"`) as string;
	} catch {
		return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
	}
}

function numberField(raw: string, key: string): number | undefined {
	const m = new RegExp(`"${key}"\\s*:\\s*(\\d+)`, 'i').exec(raw);
	if (!m?.[1]) return undefined;
	const n = Number(m[1]);
	return Number.isFinite(n) ? n : undefined;
}

/** Shell / proc JSON envelope fields (even when outputPreview is empty). */
function envelopeMeta(raw: string): {
	status?: string;
	exitCode?: number;
	outFile?: string;
	procId?: string;
	outputPreview?: string;
} {
	return {
		status: stringField(raw, 'status'),
		exitCode:
			numberField(raw, 'exitCode') ?? numberField(raw, 'exit_code') ?? numberField(raw, 'exit'),
		outFile: stringField(raw, 'outFile') ?? stringField(raw, 'out_file'),
		procId: stringField(raw, 'procId') ?? stringField(raw, 'proc_id'),
		outputPreview: stringField(raw, 'outputPreview') ?? stringField(raw, 'output_preview')
	};
}

function looksLikeJsonEnvelope(text: string): boolean {
	const t = text.trim();
	return (
		t.startsWith('{') &&
		(/"status"\s*:/.test(t) || /"exitCode"\s*:/.test(t) || /"outFile"\s*:/.test(t))
	);
}

function firstUsefulLine(body: string, max = 72): string {
	const line =
		body
			.split(/\r?\n/)
			.map(l => l.trim())
			.find(l => l.length > 0 && !/^[{}\[\],]$/.test(l) && !looksLikeJsonEnvelope(l)) ?? '';
	if (!line) return '';
	return line.length > max ? `${line.slice(0, max)}…` : line;
}

function shortPath(path: string, max = 48): string {
	if (path.length <= max) return path;
	const parts = path.split('/');
	if (parts.length < 3) return `…${path.slice(-(max - 1))}`;
	return `…/${parts.slice(-2).join('/')}`;
}

/** Parse drawer/child-work preview into structured fields for display. */
export function structureWorkPreview(raw?: string | null): StructuredWorkPreview | null {
	if (!raw?.trim()) return null;
	const chunk = lastToolResultChunk(raw.trim());
	const forAttr = chunk.startsWith('<') ? chunk : `<${chunk}`;
	const tool = toolNameAttr(chunk);
	const attrSuccess = toolResultSuccessAttr(forAttr);
	const meta = envelopeMeta(chunk);
	let body = normalizeToolOutput(forAttr).trim();
	// When envelope has no textual preview, don't dump the JSON blob as body.
	if (looksLikeJsonEnvelope(body) || (meta.outFile && body.includes('"outFile"'))) {
		body = meta.outputPreview?.trim() || '';
	}

	const exitCode = meta.exitCode;
	// ShellEnvelope: success= tool-call ok; non-zero exitCode with status=exited is
	// process outcome for the agent to read — not a tool failure (WorkspaceToolAgents).
	const success = attrSuccess;

	if (!tool && success == null && !meta.status && !body && !meta.outFile) return null;

	const bits: string[] = [];
	if (tool) bits.push(tool);
	if (success === true) bits.push('ok');
	else if (success === false) bits.push('fail');
	if (meta.status) bits.push(meta.status);
	if (exitCode != null) bits.push(`exit ${exitCode}`);
	const line = firstUsefulLine(body);
	if (line) bits.push(line);
	else if (meta.outFile) bits.push(shortPath(meta.outFile));

	return {
		tool,
		success,
		status: meta.status,
		exitCode,
		outFile: meta.outFile,
		procId: meta.procId,
		body,
		headline: bits.join(' · ')
	};
}

/** Last N non-empty lines of cleaned preview text. */
export function previewBodyLines(body: string, maxLines = 5): string {
	const lines = body.split(/\r?\n/).filter(l => l.trim().length > 0);
	return lines.slice(-maxLines).join('\n');
}
