import type {ToolRun} from '../state/model.js';
import {stripAnsi} from '../theme/semanticTheme.js';

export type ToolRendererKind = 'dense' | 'shell' | 'diff' | 'file' | 'question' | 'approval' | 'agent' | 'raw';

export type ToolDisplayModel = {
	id: string;
	tool: string;
	renderer: ToolRendererKind;
	args: Record<string, string>;
	output: Array<{stream: string; text: string}>;
	status: 'running' | 'success' | 'failed' | 'denied';
	fields: Record<string, string>;
	summary: string;
	duration?: string;
	exitCode?: string;
	command?: string;
	startedAt?: number;
	expanded: boolean;
};

const DENSE_TOOLS = new Set([
	'read_file',
	'list_dir',
	'grep',
	'glob',
	'write_file',
	'edit_file',
	'delete_file',
	'skill_view'
]);

/** Agent lifecycle ops render as one-line dense rows with the agent name inline. */
const AGENT_OPS_TOOLS = new Set(['define_agent', 'update_agent', 'delete_agent']);

export function resolveRenderer(tool: string, fields: Record<string, string>): ToolRendererKind {
	if (tool === 'shell') return 'shell';
	if (tool === 'read_file' || fields.language) return 'file';
	if (AGENT_OPS_TOOLS.has(tool)) return 'dense';
	if (fields.diff || tool === 'write_file' || tool.includes('edit') || tool === 'git.diff') return 'diff';
	if (DENSE_TOOLS.has(tool)) return 'dense';
	return 'raw';
}

/**
 * Human summary for a successful agent op. The engine's raw message
 * ("Agent 'X' defined (agentId=uuid). Sub-agents: ") leaks ids; the card
 * should read like a sentence: `define_agent 风控员 → 已定义 · 工具: read_file, grep · 最多 8 轮`.
 */
function agentOpsSummary(tool: string, args: Record<string, string>): string {
	const verb = tool === 'define_agent' ? '已定义' : tool === 'update_agent' ? '已更新' : '已删除';
	if (tool === 'delete_agent') return verb;
	const parts = [verb];
	const tools = parseJsonList(args.tools);
	if (tools.length > 0) parts.push(`工具: ${tools.join(', ')}`);
	if (args.max_turns) parts.push(`最多 ${args.max_turns} 轮`);
	return parts.join(' · ');
}

function parseJsonList(raw: string | undefined): string[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return raw.length > 0 ? [raw] : [];
	}
}

export function mapToolRun(tool: ToolRun, expanded = false): ToolDisplayModel {
	const renderer = resolveRenderer(tool.tool, tool.fields);
	const normalizedOutput = tool.output.map(chunk => ({
		...chunk,
		text: sanitizeTerminalOutputText(chunk.text)
	}));
	const summary = AGENT_OPS_TOOLS.has(tool.tool) && tool.status === 'success'
		? agentOpsSummary(tool.tool, tool.args)
		: sanitizeTerminalOutputText(tool.fields.summary ?? tool.fields.message ?? buildDefaultSummary({
			...tool,
			output: normalizedOutput
		}));
	const denied = tool.status === 'failed' && isDeniedOutput({...tool, output: normalizedOutput});
	return {
		id: tool.id,
		tool: tool.tool,
		renderer,
		args: tool.args,
		output: normalizedOutput,
		status: denied ? 'denied' : tool.status,
		fields: tool.fields,
		summary,
		duration: tool.fields.duration,
		exitCode: tool.fields.exit ?? tool.fields.exit_code,
		command: tool.args.command ?? tool.args.args ?? tool.args.input,
		startedAt: tool.startedAt,
		expanded: tool.expanded ?? expanded
	};
}

function isDeniedOutput(tool: ToolRun): boolean {
	const text = [
		...tool.output.map(output => output.text),
		tool.fields.summary,
		tool.fields.message,
		tool.fields.error
	].filter(Boolean).join('\n').toLowerCase();
	return text.includes('user denied') || text.includes('denied execution') || text.includes('permission denied');
}

/** A single grep match: file, line number, and matched content. */
export interface GrepMatch {
	file: string;
	line: number;
	content: string;
}

/**
 * Extract structured grep matches from model output lines formatted as
 * `path/to/file.ts:10:const x = 1`. Drives the list body in DenseToolMessage.
 */
export function grepMatches(model: {tool: string; status: string; output: Array<{text: string}>}): GrepMatch[] {
	if (model.tool !== 'grep' || model.status !== 'success') return [];
	const matches: GrepMatch[] = [];
	const grepRegex = /^(.+?):(\d+):(.+)$/;
	for (const chunk of model.output) {
		for (const line of chunk.text.split('\n')) {
			const m = line.trim().match(grepRegex);
			if (m) {
				matches.push({file: m[1]!, line: parseInt(m[2]!, 10), content: m[3]!.trim()});
			}
		}
	}
	return matches;
}

/** Matched paths of a successful multi-match glob (drives the list body). */
export function globMatches(model: Pick<ToolDisplayModel, 'tool' | 'status' | 'output'>): string[] {
	if (model.tool !== 'glob' || model.status !== 'success') return [];
	const files = model.output
		.flatMap(chunk => chunk.text.split('\n'))
		.map(line => line.trim())
		.filter(line => line.length > 0 && !line.startsWith('['));
	if (files.length <= 1 || files[0]?.startsWith('no files match')) return [];
	return files;
}

function buildDefaultSummary(tool: ToolRun): string {
	if (tool.output.length > 0) {
		// grep: show structured match count instead of raw truncated lines
		if (tool.tool === 'grep') {
			const matches = grepMatches(tool);
			if (matches.length > 0) {
				const fileCount = new Set(matches.map(m => m.file)).size;
				return `${matches.length} 个匹配，${fileCount} 个文件`;
			}
		}
		// Glob output is one path per line; the generic "first line" summary made
		// `glob → single-file` look like there was exactly one match. The header
		// carries the total; the matches render as a list body under it.
		const globFiles = globMatches(tool);
		if (globFiles.length > 0) {
			return `共 ${globFiles.length} 个文件`;
		}
		const last = tool.output.at(-1)?.text ?? '';
		return last.split('\n').map(l => l.trim()).filter(l => l.length > 0).join(' ').slice(0, 120);
	}
	const args = Object.entries(tool.args).map(([k, v]) => `${k}=${v}`).join(' ');
	return args.slice(0, 80);
}

interface ParsedToolResult {
	name?: string;
	success?: boolean;
	kind?: string;
	recoverable?: boolean;
	fields: Record<string, string>;
}

function parseToolResultXml(text: string): ParsedToolResult | null {
	const trimmed = text.trim();
	// Match <tool_result ...> ... </tool_result>
	const match = trimmed.match(/^<tool_result\b([^>]*)>([\s\S]*?)<\/tool_result>$/i);
	if (!match) {
		return null;
	}

	const attrStr = match[1] || '';
	const body = match[2] || '';

	// Parse attributes
	const attrs: Record<string, string> = {};
	const attrRegex = /(\w+)="([^"]*)"/g;
	let attrMatch;
	while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
		attrs[attrMatch[1]!] = attrMatch[2]!;
	}

	// Parse body fields (key: value)
	const fields: Record<string, string> = {};
	const lines = body.split('\n');
	let currentKey: string | null = null;
	let currentValueLines: string[] = [];

	const knownKeys = new Set(['output', 'summary', 'error', 'reason', 'duration_ms']);

	for (const line of lines) {
		const colonIndex = line.indexOf(':');
		if (colonIndex !== -1) {
			const keyCandidate = line.substring(0, colonIndex).trim();
			if (knownKeys.has(keyCandidate)) {
				if (currentKey) {
					fields[currentKey] = currentValueLines.join('\n').trim();
				}
				currentKey = keyCandidate;
				currentValueLines = [line.substring(colonIndex + 1)];
				continue;
			}
		}
		
		if (currentKey) {
			currentValueLines.push(line);
		} else {
			// If no key yet, treat it as part of a default "output" field
			currentKey = 'output';
			currentValueLines.push(line);
		}
	}

	if (currentKey) {
		fields[currentKey] = currentValueLines.join('\n').trim();
	}

	return {
		name: attrs['name'],
		success: attrs['success'] === 'true',
		kind: attrs['kind'],
		recoverable: attrs['recoverable'] === 'true',
		fields
	};
}

function cleanToolResultTags(text: string): string {
	const parsed = parseToolResultXml(text);
	if (parsed) {
		if (parsed.success === false) {
			return parsed.fields.error || parsed.fields.reason || parsed.fields.duration_ms || '';
		}
		return parsed.fields.output || parsed.fields.summary || '';
	}

	let cleaned = text.trim();

	// 1. Strip <tool_result ...> and </tool_result> tags
	cleaned = cleaned.replace(/^<tool_result\b[^>]*>\s*/i, '');
	cleaned = cleaned.replace(/\s*<\/tool_result>$/i, '');

	// 2. Strip summary section if present
	const summaryIndex = cleaned.lastIndexOf('\nsummary:');
	if (summaryIndex !== -1) {
		cleaned = cleaned.substring(0, summaryIndex);
	} else if (cleaned.startsWith('summary:')) {
		cleaned = '';
	}

	// 3. Split into lines to process prefixes
	const lines = cleaned.split('\n');
	const processedLines: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		
		// Strip "output: ", "error: ", "reason: " prefixes from the start of lines
		if (line.startsWith('output:')) {
			processedLines.push(line.substring('output:'.length).trim());
		} else if (line.startsWith('error:')) {
			processedLines.push(line.substring('error:'.length).trim());
		} else if (line.startsWith('reason:')) {
			processedLines.push(line.substring('reason:'.length).trim());
		} else {
			processedLines.push(line);
		}
	}

	return processedLines.join('\n').trim();
}

/**
 * Normalize streamed terminal chunks before rendering in Ink:
 * - strip ANSI control sequences
 * - interpret CR as overwrite to line start
 * - apply backspace erasure semantics
 * - drop remaining non-printable control chars
 */
function sanitizeTerminalOutputText(raw: string): string {
	const withoutAnsi = stripAnsi(raw).replace(/\r\n/g, '\n');
	const cleaned = cleanToolResultTags(withoutAnsi);
	return cleaned
		.split('\n')
		.map(line => sanitizeTerminalLine(line))
		.join('\n');
}

function sanitizeTerminalLine(line: string): string {
	let value = '';
	for (const char of line) {
		if (char === '\r') {
			value = '';
			continue;
		}
		if (char === '\b' || char === '\u007f') {
			value = value.slice(0, -1);
			continue;
		}
		const code = char.charCodeAt(0);
		if (code < 32 && char !== '\t') {
			continue;
		}
		value += char;
	}
	return value;
}

export function groupToolsByTurn(tools: ToolRun[], expanded = false): ToolDisplayModel[] {
	return tools.map(tool => mapToolRun(tool, tool.expanded ?? expanded));
}
