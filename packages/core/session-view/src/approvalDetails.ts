/**
 * Parse Bridge approval payloads into a layered view model
 * (ported/adapted from cli-ink ApprovalDialog).
 *
 * Chrome fields are semantic ids — hosts format via i18n `t()` or `formatApprovalEn`.
 */

export type ShellIntent =
	| 'dev_server'
	| 'install_deps'
	| 'run_tests'
	| 'build'
	| 'git'
	| 'python'
	| 'shell';

export type ShellRisk = 'operators' | 'background' | 'network_or_install' | 'git_remote' | 'arbitrary';

export type RiskBadge =
	| 'external_directory'
	| 'read_only'
	| 'workspace_write'
	| 'shell'
	| 'destructive'
	| 'external_side_effect'
	| 'unsandboxed'
	| 'git';

export type ApprovalTitle =
	| {kind: 'external_directory'}
	| {kind: 'bash'}
	| {kind: 'bash_unsandboxed'}
	| {kind: 'delete_file'}
	| {kind: 'git'}
	| {kind: 'write_file'}
	| {kind: 'edit_file'}
	| {kind: 'define_subagent'}
	| {kind: 'subagent'; name?: string}
	| {kind: 'mcp_tool'; server?: string; tool?: string}
	| {kind: 'tool'; tool: string};

export type SubjectLabel =
	| 'directory'
	| 'directories'
	| 'command'
	| 'target'
	| 'change'
	| 'subagent_spec'
	| 'arguments'
	| 'details';

export type ApprovalReason =
	| {kind: 'external_directory'}
	| {kind: 'unsandboxed'}
	| {kind: 'shell'; risk: ShellRisk}
	| {kind: 'delete_file'}
	| {kind: 'git'}
	| {kind: 'workspace_write'}
	| {kind: 'subagent'}
	| {kind: 'mcp'}
	| {kind: 'generic_with_risk'; risk: string}
	| {kind: 'generic'};

export type ApprovalTitleHint =
	| {kind: 'subagent'; name?: string}
	| {kind: 'mcp_tool'; server?: string; tool?: string};

export type ApprovalViewModel = {
	title: ApprovalTitle;
	riskBadge: RiskBadge | null;
	/** Unknown risk values pass through for display (not catalogued). */
	riskRaw?: string;
	subjectLabel: SubjectLabel;
	subject: string;
	/** Secondary payload (e.g. command under an external-directory gate). */
	secondaryLabel?: SubjectLabel;
	secondary?: string;
	reason: ApprovalReason;
};

export type ApprovalViewModelEn = {
	title: string;
	riskLabel: string | null;
	subjectLabel: string;
	subject: string;
	secondaryLabel?: string;
	secondary?: string;
	reason: string;
};

/**
 * Local English map — avoids `@fast-ide/i18n` `createI18n` (node:fs) in desktop
 * renderer bundles that import `@fast-ide/session-view`. Desktop uses `t()`.
 */
const en = {
	'session.approval.title.external_directory': 'External directory access',
	'session.approval.title.bash': 'Bash command',
	'session.approval.title.bash_unsandboxed': 'Bash command (unsandboxed)',
	'session.approval.title.delete_file': 'Delete file',
	'session.approval.title.git': 'Git command',
	'session.approval.title.write_file': 'Write file',
	'session.approval.title.edit_file': 'Edit file',
	'session.approval.title.define_subagent': 'Define Subagent',
	'session.approval.title.subagent': 'Subagent',
	'session.approval.title.subagentNamed': (name: string) => `Subagent: ${name}`,
	'session.approval.title.mcp_tool': 'MCP Tool',
	'session.approval.title.mcp_toolNamed': (tool: string) => `MCP Tool: ${tool}`,
	'session.approval.title.mcp_toolQualified': (server: string, tool: string) =>
		`MCP Tool: ${server}/${tool}`,
	'session.approval.title.tool': (tool: string) => `${tool} approval`,
	'session.approval.risk.external_directory': 'External directory',
	'session.approval.risk.read_only': 'Read only',
	'session.approval.risk.workspace_write': 'Workspace write',
	'session.approval.risk.shell': 'Shell',
	'session.approval.risk.destructive': 'Destructive',
	'session.approval.risk.external_side_effect': 'External side effect',
	'session.approval.risk.unsandboxed': 'Unsandboxed',
	'session.approval.risk.git': 'Git',
	'session.approval.label.directory': 'Directory',
	'session.approval.label.directories': 'Directories',
	'session.approval.label.command': 'Command',
	'session.approval.label.target': 'Target',
	'session.approval.label.change': 'Change',
	'session.approval.label.subagent_spec': 'Subagent Spec',
	'session.approval.label.arguments': 'Arguments',
	'session.approval.label.details': 'Details',
	'session.approval.reason.external_directory':
		'This command touches paths outside the workspace. Approving allows access for this run; Always trusts the directory for this session.',
	'session.approval.reason.unsandboxed':
		'Runs outside the sandbox with full host access — only approve if the sandbox denial was legitimate.',
	'session.approval.reason.delete_file':
		'This operation removes files and cannot always be undone.',
	'session.approval.reason.git':
		'This command may change repository state or interact with a remote.',
	'session.approval.reason.workspace_write': 'This action modifies files in the workspace.',
	'session.approval.reason.subagent':
		'Defining or spawning a subagent allows it to perform autonomous steps.',
	'session.approval.reason.mcp':
		'This action invokes an external Model Context Protocol tool.',
	'session.approval.reason.generic': 'This action requires approval for safety.',
	'session.approval.reason.generic_with_risk': (risk: string) =>
		`Risk: ${risk}. This action requires approval.`,
	'session.approval.shell_risk.operators':
		'This command uses shell operators that require approval for safety.',
	'session.approval.shell_risk.background':
		'This command starts a background process that may keep running.',
	'session.approval.shell_risk.network_or_install':
		'This command may install packages or access the network.',
	'session.approval.shell_risk.git_remote':
		'This git command may interact with a remote repository.',
	'session.approval.shell_risk.arbitrary':
		'This command can execute arbitrary code on your machine.',
	'session.approval.shell_intent.dev_server': 'Start development server',
	'session.approval.shell_intent.install_deps': 'Install project dependencies',
	'session.approval.shell_intent.run_tests': 'Run project tests',
	'session.approval.shell_intent.build': 'Build the project',
	'session.approval.shell_intent.git': 'Run git command',
	'session.approval.shell_intent.python': 'Run Python script',
	'session.approval.shell_intent.shell': 'Run shell command'
} as const;

/** Directories listed by the runtime's external-directory gate:
 *  `... [external directories: /a, /b]`. */
export function extractExternalDirectories(description: string): string[] {
	const match = description?.match(/\[external directories:\s*([^\]]+)\]/);
	if (!match?.[1]) return [];
	return match[1]
		.split(',')
		.map(d => d.trim())
		.filter(Boolean);
}

function unescapeJsonString(s: string): string {
	return s
		.replace(/\\n/g, '\n')
		.replace(/\\t/g, '\t')
		.replace(/\\r/g, '\r')
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, '\\');
}

function tryParseJson(str: string): Record<string, unknown> | null {
	const trimmed = str.trim();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
	try {
		const parsed = JSON.parse(trimmed);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		try {
			const sanitized = trimmed.replace(/"(?:[^"\\]|\\.)*"/g, match =>
				match.replace(/[\u0000-\u001F]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
			);
			const parsed = JSON.parse(sanitized);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			/* ignore */
		}
	}
	return null;
}

/** Format a JSON object or tool payload into human-readable structured text. */
export function formatApprovalSubject(raw: string): {
	subject: string;
	titleHint?: ApprovalTitleHint;
} {
	if (!raw) return {subject: ''};
	let text = raw.trim();

	// Check if wrapped in tool_name(...)
	let toolName: string | null = null;
	const match = text.match(/^(\w+)\(([\s\S]*)\)$/);
	if (match?.[2]) {
		toolName = match[1]!;
		text = match[2].trim();
	}

	// 1. edit_file diff preview
	if (toolName === 'edit_file') {
		const parsed = tryParseJson(text);
		if (parsed) {
			const path = typeof parsed.path === 'string' ? parsed.path : '';
			const oldStr = typeof parsed.old_string === 'string' ? parsed.old_string : '';
			const newStr = typeof parsed.new_string === 'string' ? parsed.new_string : '';
			if (oldStr || newStr) {
				const oldDiff = oldStr.split('\n').slice(0, 4).map(l => `-${l}`).join('\n');
				const newDiff = newStr.split('\n').slice(0, 4).map(l => `+${l}`).join('\n');
				return {subject: `edit_file(${path})\n--- old\n+++ new\n${oldDiff}\n${newDiff}`};
			}
			if (path) return {subject: path};
		}
	}

	// 2. Try parsing JSON
	const parsed = tryParseJson(text);
	if (parsed) {
		// Single command / path parameter
		const cmd = parsed.command ?? parsed.args ?? parsed.input ?? parsed.file ?? parsed.path;
		if (typeof cmd === 'string' && cmd.trim() && Object.keys(parsed).length <= 2) {
			return {subject: unescapeJsonString(cmd)};
		}

		// Agent / Subagent definition (e.g. define_agent, spawn_agent, subagent)
		if (parsed.name || parsed.system_prompt || parsed.prompt || parsed.tools) {
			const name = typeof parsed.name === 'string' ? parsed.name : undefined;
			const desc = typeof parsed.description === 'string' ? parsed.description : undefined;
			const model = typeof parsed.model === 'string' ? parsed.model : undefined;
			const scope = typeof parsed.scope === 'string' ? parsed.scope : undefined;
			const tools = Array.isArray(parsed.tools) ? parsed.tools.join(', ') : undefined;
			const prompt =
				typeof parsed.system_prompt === 'string'
					? parsed.system_prompt
					: typeof parsed.prompt === 'string'
						? parsed.prompt
						: undefined;

			const parts: string[] = [];
			if (name) parts.push(`Name: ${name}`);
			if (desc) parts.push(`Description: ${desc}`);
			if (tools) parts.push(`Tools: ${tools}`);
			const metaParts = [model ? `Model: ${model}` : null, scope ? `Scope: ${scope}` : null].filter(Boolean);
			if (metaParts.length > 0) parts.push(metaParts.join(' | '));
			if (prompt) parts.push(`\nSystem Prompt:\n${unescapeJsonString(prompt)}`);

			if (parts.length > 0) {
				return {
					subject: parts.join('\n'),
					titleHint: {kind: 'subagent', name}
				};
			}
		}

		// MCP tool call
		if (parsed.server || parsed.toolName) {
			const server = typeof parsed.server === 'string' ? parsed.server : undefined;
			const tool = typeof parsed.toolName === 'string' ? parsed.toolName : undefined;
			const args = parsed.arguments ?? parsed.args;
			const argsStr = args ? JSON.stringify(args, null, 2) : '';
			return {
				subject: argsStr ? unescapeJsonString(argsStr) : text,
				titleHint: {kind: 'mcp_tool', server, tool}
			};
		}

		// General JSON: pretty print with unescaped control characters
		const formatted = JSON.stringify(parsed, null, 2);
		return {subject: unescapeJsonString(formatted)};
	}

	return {subject: unescapeJsonString(text)};
}

/** Pull a human-readable command/path out of `tool({...})` wrappers. */
export function extractCommandFromToolCall(subject: string): string {
	return formatApprovalSubject(subject).subject;
}

export function shellIntent(command: string): ShellIntent {
	const normalized = command.toLowerCase();
	if (normalized.includes('npm run dev') || normalized.includes('vite')) return 'dev_server';
	if (
		normalized.includes('npm install') ||
		normalized.includes('pnpm install') ||
		normalized.includes('yarn install')
	) {
		return 'install_deps';
	}
	if (normalized.includes('test')) return 'run_tests';
	if (normalized.includes('build')) return 'build';
	if (normalized.startsWith('git ')) return 'git';
	if (normalized.includes('python') || normalized.includes('python3')) return 'python';
	return 'shell';
}

export function shellRisk(command: string): ShellRisk {
	const normalized = command.toLowerCase();
	if (/[;&|`<>]/.test(command) || command.includes('$(')) return 'operators';
	if (/\s&\s*$/.test(command)) return 'background';
	if (
		normalized.includes('npm install') ||
		normalized.includes('curl ') ||
		normalized.includes('wget ') ||
		normalized.includes('npx ')
	) {
		return 'network_or_install';
	}
	if (normalized.startsWith('git push') || normalized.startsWith('git pull')) return 'git_remote';
	return 'arbitrary';
}

export function riskBadge(risk?: string): RiskBadge | null {
	if (!risk?.trim()) return null;
	switch (risk.toLowerCase()) {
		case 'external_directory':
		case 'externaldirectory':
			return 'external_directory';
		case 'readonly':
		case 'read_only':
			return 'read_only';
		case 'workspacewrite':
		case 'workspace_write':
			return 'workspace_write';
		case 'shell':
			return 'shell';
		case 'destructive':
			return 'destructive';
		case 'externalsideeffect':
		case 'external_side_effect':
		case 'external':
			return 'external_side_effect';
		default:
			return null;
	}
}

function titleFromHint(fallback: ApprovalTitle, hint?: ApprovalTitleHint): ApprovalTitle {
	if (!hint) return fallback;
	if (hint.kind === 'subagent') return {kind: 'subagent', name: hint.name};
	return {kind: 'mcp_tool', server: hint.server, tool: hint.tool};
}

export function buildApprovalViewModel(input: {
	tool: string;
	description: string;
	risk?: string;
	context?: string;
}): ApprovalViewModel {
	const rawSubject = (input.context?.trim() || input.description || '').trim();
	const formatted = formatApprovalSubject(rawSubject);
	const cleanedSubject = formatted.subject;
	const badge = riskBadge(input.risk);
	const riskRaw = badge == null && input.risk?.trim() ? input.risk.trim() : undefined;
	const unsandboxed = input.description?.includes('[UNSANDBOXED');
	const riskKey = (input.risk ?? '').toLowerCase();

	if (riskKey === 'external_directory' || riskKey === 'externaldirectory') {
		const dirs = extractExternalDirectories(input.description);
		const cmd = cleanedSubject
			? `${input.tool === 'shell' ? '' : `[${input.tool}] `}${cleanedSubject}`
			: '';
		return {
			title: {kind: 'external_directory'},
			riskBadge: badge ?? 'external_directory',
			subjectLabel: dirs.length > 1 ? 'directories' : 'directory',
			subject: dirs.length > 0 ? dirs.join('\n') : cleanedSubject,
			secondaryLabel: cmd ? 'command' : undefined,
			secondary: cmd || undefined,
			reason: {kind: 'external_directory'}
		};
	}

	switch (input.tool) {
		case 'shell':
			return {
				title: unsandboxed ? {kind: 'bash_unsandboxed'} : {kind: 'bash'},
				riskBadge: unsandboxed ? 'unsandboxed' : badge,
				riskRaw: unsandboxed ? undefined : riskRaw,
				subjectLabel: 'command',
				subject: cleanedSubject || input.description,
				reason: unsandboxed
					? {kind: 'unsandboxed'}
					: {kind: 'shell', risk: shellRisk(cleanedSubject)}
			};
		case 'delete_file':
			return {
				title: {kind: 'delete_file'},
				riskBadge: badge ?? 'destructive',
				riskRaw: badge ? undefined : riskRaw,
				subjectLabel: 'target',
				subject: cleanedSubject || input.context || input.description,
				reason: {kind: 'delete_file'}
			};
		case 'git':
			return {
				title: {kind: 'git'},
				riskBadge: badge ?? 'git',
				riskRaw: badge ? undefined : riskRaw,
				subjectLabel: 'command',
				subject: cleanedSubject || input.description,
				reason: {kind: 'git'}
			};
		case 'edit_file':
		case 'write_file':
			return {
				title: input.tool === 'write_file' ? {kind: 'write_file'} : {kind: 'edit_file'},
				riskBadge: badge ?? 'workspace_write',
				riskRaw: badge ? undefined : riskRaw,
				subjectLabel: 'change',
				subject: cleanedSubject || input.description,
				reason: {kind: 'workspace_write'}
			};
		case 'define_agent':
		case 'spawn_agent':
		case 'subagent':
			return {
				title: titleFromHint({kind: 'define_subagent'}, formatted.titleHint),
				riskBadge: badge ?? 'external_side_effect',
				riskRaw: badge ? undefined : riskRaw,
				subjectLabel: 'subagent_spec',
				subject: cleanedSubject || input.description,
				reason: {kind: 'subagent'}
			};
		case 'call_mcp_tool':
		case 'mcp_tool':
			return {
				title: titleFromHint({kind: 'mcp_tool'}, formatted.titleHint),
				riskBadge: badge ?? 'external_side_effect',
				riskRaw: badge ? undefined : riskRaw,
				subjectLabel: 'arguments',
				subject: cleanedSubject || input.description,
				reason: {kind: 'mcp'}
			};
		default:
			return {
				title: titleFromHint({kind: 'tool', tool: input.tool}, formatted.titleHint),
				riskBadge: badge,
				riskRaw,
				subjectLabel: 'details',
				subject: cleanedSubject || input.description,
				reason: input.risk
					? {kind: 'generic_with_risk', risk: input.risk}
					: {kind: 'generic'}
			};
	}
}

/** Short intent id for shell (optional subtitle). */
export function shellApprovalIntent(command: string): ShellIntent {
	return shellIntent(command);
}

export function formatApprovalTitleEn(title: ApprovalTitle): string {
	switch (title.kind) {
		case 'external_directory':
			return en['session.approval.title.external_directory'];
		case 'bash':
			return en['session.approval.title.bash'];
		case 'bash_unsandboxed':
			return en['session.approval.title.bash_unsandboxed'];
		case 'delete_file':
			return en['session.approval.title.delete_file'];
		case 'git':
			return en['session.approval.title.git'];
		case 'write_file':
			return en['session.approval.title.write_file'];
		case 'edit_file':
			return en['session.approval.title.edit_file'];
		case 'define_subagent':
			return en['session.approval.title.define_subagent'];
		case 'subagent':
			return title.name
				? en['session.approval.title.subagentNamed'](title.name)
				: en['session.approval.title.subagent'];
		case 'mcp_tool':
			if (title.server && title.tool) {
				return en['session.approval.title.mcp_toolQualified'](title.server, title.tool);
			}
			if (title.tool) return en['session.approval.title.mcp_toolNamed'](title.tool);
			return en['session.approval.title.mcp_tool'];
		case 'tool':
			return en['session.approval.title.tool'](title.tool);
	}
}

export function formatRiskBadgeEn(badge: RiskBadge | null, riskRaw?: string): string | null {
	if (badge) return en[`session.approval.risk.${badge}`];
	return riskRaw ?? null;
}

export function formatSubjectLabelEn(label: SubjectLabel): string {
	return en[`session.approval.label.${label}`];
}

export function formatApprovalReasonEn(reason: ApprovalReason): string {
	switch (reason.kind) {
		case 'external_directory':
			return en['session.approval.reason.external_directory'];
		case 'unsandboxed':
			return en['session.approval.reason.unsandboxed'];
		case 'shell':
			return en[`session.approval.shell_risk.${reason.risk}`];
		case 'delete_file':
			return en['session.approval.reason.delete_file'];
		case 'git':
			return en['session.approval.reason.git'];
		case 'workspace_write':
			return en['session.approval.reason.workspace_write'];
		case 'subagent':
			return en['session.approval.reason.subagent'];
		case 'mcp':
			return en['session.approval.reason.mcp'];
		case 'generic_with_risk':
			return en['session.approval.reason.generic_with_risk'](reason.risk);
		case 'generic':
			return en['session.approval.reason.generic'];
	}
}

export function formatShellIntentEn(intent: ShellIntent): string {
	return en[`session.approval.shell_intent.${intent}`];
}

/** English formatter for ink / Node hosts that do not run react-i18next. */
export function formatApprovalEn(view: ApprovalViewModel): ApprovalViewModelEn {
	return {
		title: formatApprovalTitleEn(view.title),
		riskLabel: formatRiskBadgeEn(view.riskBadge, view.riskRaw),
		subjectLabel: formatSubjectLabelEn(view.subjectLabel),
		subject: view.subject,
		secondaryLabel: view.secondaryLabel ? formatSubjectLabelEn(view.secondaryLabel) : undefined,
		secondary: view.secondary,
		reason: formatApprovalReasonEn(view.reason)
	};
}
