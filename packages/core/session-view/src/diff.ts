/** Diff line model (ported from cli-ink DiffToolMessage). */
export type DiffLine =
	| {type: 'add'; newLine: number; content: string}
	| {type: 'del'; oldLine: number; content: string}
	| {type: 'context'; oldLine: number; newLine: number; content: string}
	| {type: 'hunk'; content: string}
	| {type: 'other'; content: string};

export function countDiffStats(diff?: string): {add: number; del: number} {
	if (!diff) return {add: 0, del: 0};
	let add = 0;
	let del = 0;
	for (const line of diff.split('\n')) {
		if (line.startsWith('+') && !line.startsWith('+++')) add += 1;
		else if (line.startsWith('-') && !line.startsWith('---')) del += 1;
	}
	return {add, del};
}

export function parseDiffWithLineNumbers(diffContent: string): DiffLine[] {
	const result: DiffLine[] = [];
	let oldLine = 0;
	let newLine = 0;
	let inHunk = false;
	const hunkHeader = /^@@ -(\d+),?\d* \+(\d+),?\d* @@/;

	for (const line of diffContent.split(/\r?\n/)) {
		const match = line.match(hunkHeader);
		if (match) {
			oldLine = Number.parseInt(match[1] ?? '1', 10) - 1;
			newLine = Number.parseInt(match[2] ?? '1', 10) - 1;
			inHunk = true;
			result.push({type: 'hunk', content: line});
			continue;
		}
		if (!inHunk) {
			if (!line.startsWith('--- ') && !line.startsWith('+++ ') && line.trim().length > 0) {
				result.push({type: 'other', content: line});
			}
			continue;
		}
		if (line.startsWith('+')) {
			newLine += 1;
			result.push({type: 'add', newLine, content: line.slice(1)});
		} else if (line.startsWith('-')) {
			oldLine += 1;
			result.push({type: 'del', oldLine, content: line.slice(1)});
		} else if (line.startsWith(' ')) {
			oldLine += 1;
			newLine += 1;
			result.push({type: 'context', oldLine, newLine, content: line.slice(1)});
		}
	}

	return result;
}

/** Prefer first change hunk within budget (cli-ink diffPreview). */
export function diffPreview(lines: DiffLine[], budget: number): DiffLine[] {
	if (budget <= 0 || lines.length === 0) return [];
	if (lines.length <= budget) return lines;
	const firstChangeIdx = lines.findIndex(line => line.type === 'add' || line.type === 'del');
	if (firstChangeIdx < 0) return lines.slice(0, budget);
	if (firstChangeIdx < budget) return lines.slice(0, budget);

	let hunkIdx = -1;
	for (let i = firstChangeIdx - 1; i >= 0; i--) {
		if (lines[i]!.type === 'hunk') {
			hunkIdx = i;
			break;
		}
	}
	if (hunkIdx >= 0 && firstChangeIdx - hunkIdx < budget) {
		return lines.slice(hunkIdx, hunkIdx + budget);
	}
	if (hunkIdx >= 0 && budget >= 2) {
		return [lines[hunkIdx]!, ...lines.slice(firstChangeIdx, firstChangeIdx + budget - 1)];
	}
	// Lead with one context line when possible so the change isn't flush to the top.
	const lead = budget >= 2 && firstChangeIdx > 0 ? 1 : 0;
	const start = firstChangeIdx - lead;
	return lines.slice(start, start + budget);
}

export function lineNumberFor(line: DiffLine): number | undefined {
	switch (line.type) {
		case 'add':
			return line.newLine;
		case 'del':
			return line.oldLine;
		case 'context':
			return line.newLine;
		default:
			return undefined;
	}
}

export type ActivityCounts = {
	explored: number;
	searched: number;
	fetched: number;
	edited: number;
};

export function classifyToolActivity(tool: string): keyof ActivityCounts | 'other' {
	const t = tool.trim().toLowerCase();
	// Exact names only — no substring match (avoids `my_file_edit_x` false positives).
	if (
		/^(write|edit|create|apply_?patch|search_?replace|str_?replace|file_write|write_file|file_edit|edit_file)$/i.test(
			t
		)
	) {
		return 'edited';
	}
	if (/fetch|http|curl|download|web_fetch|wget/i.test(t)) return 'fetched';
	if (/grep|search|glob|find/i.test(t)) return 'searched';
	if (/read|list|explore|cat|open/i.test(t)) return 'explored';
	return 'other';
}

/** True when the tool counts as a file write for Code Changes / timeline file cards. */
export function isWriteTool(tool: string): boolean {
	return classifyToolActivity(tool) === 'edited';
}

/** Cursor-style: "Explored 14 files, 1 search, 1 fetch" / "Edited 3 files". */
export function formatActivitySummary(counts: ActivityCounts): string {
	const parts: string[] = [];
	if (counts.explored > 0) {
		parts.push(`Explored ${counts.explored} file${counts.explored === 1 ? '' : 's'}`);
	}
	if (counts.searched > 0) {
		parts.push(`${counts.searched} search${counts.searched === 1 ? '' : 'es'}`);
	}
	if (counts.fetched > 0) {
		parts.push(`${counts.fetched} fetch${counts.fetched === 1 ? '' : 'es'}`);
	}
	if (counts.edited > 0 && parts.length === 0) {
		parts.push(`Edited ${counts.edited} file${counts.edited === 1 ? '' : 's'}`);
	} else if (counts.edited > 0) {
		parts.push(`edited ${counts.edited}`);
	}
	return parts.join(', ');
}
