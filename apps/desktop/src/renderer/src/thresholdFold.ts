export const SHELL_OUTPUT_FOLD_LINES = 20;
export const FILE_DIFF_FOLD_LINES = 200;

export function outputLineCount(output: string | null | undefined): number {
	if (!output) return 0;
	let lines = 1;
	for (let i = 0; i < output.length; i++) {
		if (output.charCodeAt(i) === 10) lines += 1;
	}
	return output.endsWith('\n') ? lines - 1 : lines;
}

function outputExceedsLineCount(
	output: string | null | undefined,
	maxLines: number
): boolean {
	if (!output) return false;
	let lines = 1;
	for (let i = 0; i < output.length; i++) {
		if (output.charCodeAt(i) !== 10 || i === output.length - 1) continue;
		lines += 1;
		if (lines > maxLines) return true;
	}
	return false;
}

export function isShellTool(tool: string | undefined, command: string | null | undefined): boolean {
	return Boolean(command) || /shell|bash|terminal|command/i.test(tool ?? '');
}

export function shouldThresholdFoldTool(
	item: {
		tool?: string;
		command?: string | null;
		status?: string;
		output?: string | null;
	}
): boolean {
	return (
		item.status !== 'running' &&
		isShellTool(item.tool, item.command) &&
		outputExceedsLineCount(item.output, SHELL_OUTPUT_FOLD_LINES)
	);
}

/** Full visible diff size; `lines` itself is capped at 48 by Session View. */
export function fileDiffLineCount(
	item: {lines?: readonly unknown[]; hidden?: number}
): number {
	return (item.lines?.length ?? 0) + Math.max(0, item.hidden ?? 0);
}

export function shouldThresholdFoldFile(
	item: {status?: string; lines?: readonly unknown[]; hidden?: number}
): boolean {
	return item.status !== 'running' && fileDiffLineCount(item) > FILE_DIFF_FOLD_LINES;
}
