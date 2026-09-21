import type {ToolCallView} from '../transcriptProjection.js';
import {classifyToolActivity} from '../diff.js';

export function isExploreLike(tool: string): boolean {
	// Subagent delegation rows ("agent: <name>") always stand alone — the agent's
	// display name must not leak into the activity classifier (e.g. "researcher").
	if (tool.startsWith('agent: ')) return false;
	const kind = classifyToolActivity(tool);
	return kind === 'explored' || kind === 'searched' || kind === 'fetched';
}

/** Last 2 path segments for Exploring chrome (avoid burying the search needle). */
export function shortPath(path: string): string {
	const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
	if (parts.length <= 2) return parts.join('/') || path;
	return parts.slice(-2).join('/');
}

/** Grep / glob / find needle — pattern first, then query / glob aliases. */
export function searchNeedle(args: Record<string, string>): string | undefined {
	const raw =
		args.pattern?.trim() ||
		args.query?.trim() ||
		args.glob?.trim() ||
		args.regex?.trim() ||
		args.needle?.trim();
	return raw || undefined;
}

export function isSearchTool(tool: string): boolean {
	return /grep|search|glob|find/i.test(tool);
}

export function formatToolArgs(tool: string, args?: Record<string, string>): string | null {
	if (!args) return null;
	if (/shell|bash|terminal|command/i.test(tool) && args.command) return `$ ${args.command}`;
	// Search: title carries the needle; summary is only the scope path.
	if (isSearchTool(tool)) {
		const path = args.path?.trim();
		if (path) return shortPath(path);
		return null;
	}
	if (args.path && Object.keys(args).length <= 2) {
		// Path-only tools already use the path as their title. When description
		// becomes the title, retain the path as useful secondary context.
		return args.description?.trim() ? args.path : null;
	}
	try {
		return JSON.stringify(args);
	} catch {
		return null;
	}
}

export function toolCommand(tool: string, args?: Record<string, string>): string | null {
	if (!args) return null;
	if (/shell|bash|terminal|command/i.test(tool) && args.command) return args.command;
	return null;
}

export function toolTitle(tool: string, args?: Record<string, string>): string {
	const description = args?.description?.trim();
	if (description) return description;
	const command = toolCommand(tool, args);
	if (command) {
		const oneLine = command.replace(/\s+/g, ' ').trim();
		return oneLine.length > 72 ? `${oneLine.slice(0, 69)}…` : oneLine;
	}
	if (isSearchTool(tool)) {
		const needle = searchNeedle(args ?? {});
		const kind = tool.trim().toLowerCase() || 'search';
		if (needle) return `${kind} ${needle}`;
		return kind;
	}
	if (args?.path) {
		const rawVerb = tool.toLowerCase().replace(/_file|_dir|_tool/g, '').trim();
		const verb = rawVerb || 'read';
		return `${verb} ${shortPath(args.path)}`;
	}
	return tool;
}

export function pathFromTool(tool: ToolCallView): string | undefined {
	return tool.args?.path ?? tool.args?.file ?? tool.args?.filepath ?? tool.args?.file_path;
}

export function resolveDiffText(
	tool: ToolCallView,
	fileDiffs: Record<string, string | undefined>
): string | undefined {
	const path = pathFromTool(tool);
	return (
		fileDiffs[tool.id] ??
		(path ? fileDiffs[path] : undefined) ??
		tool.output ??
		undefined
	);
}
