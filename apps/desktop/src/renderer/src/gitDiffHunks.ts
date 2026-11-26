import type {FileReviewDiff, GitFileDiff} from '@fast-ide/session-view';

export type GitHunkLine = {
	kind: 'context' | 'add' | 'del';
	oldLine: number | null;
	newLine: number | null;
	text: string;
};

export type GitHunk = {
	header: string;
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	additions: number;
	deletions: number;
	targetLine: number;
	lines: GitHunkLine[];
};

type GitHunkHeader = {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseGitHunkHeader(header: string): GitHunkHeader | null {
	const match = HUNK_HEADER.exec(header);
	if (!match) return null;
	return {
		oldStart: Number(match[1]),
		oldLines: match[2] == null ? 1 : Number(match[2]),
		newStart: Number(match[3]),
		newLines: match[4] == null ? 1 : Number(match[4])
	};
}

/**
 * Git emits unified-diff lines without coordinates. Hunk headers carry the starts, so walk the
 * lines once to recover the old/new line each entry belongs to; Monaco overlays need the new side.
 */
export function gitDiffHunks(diff: GitFileDiff): GitHunk[] {
	return diff.hunks.map(raw => {
		const header = parseGitHunkHeader(raw.header);
		let oldLine = header?.oldStart ?? 0;
		let newLine = header?.newStart ?? 0;
		let additions = 0;
		let deletions = 0;
		const lines = raw.lines.map((rawLine): GitHunkLine => {
			const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
			if (line.startsWith('+')) {
				additions += 1;
				const entry = {
					kind: 'add' as const,
					oldLine: null,
					newLine: header ? newLine : null,
					text: line.slice(1)
				};
				if (header) newLine += 1;
				return entry;
			}
			if (line.startsWith('-')) {
				deletions += 1;
				const entry = {
					kind: 'del' as const,
					oldLine: header ? oldLine : null,
					newLine: null,
					text: line.slice(1)
				};
				if (header) oldLine += 1;
				return entry;
			}
			if (line.startsWith('\\')) {
				return {kind: 'context', oldLine: null, newLine: null, text: line};
			}
			const entry = {
				kind: 'context' as const,
				oldLine: header ? oldLine : null,
				newLine: header ? newLine : null,
				text: line.startsWith(' ') ? line.slice(1) : line
			};
			if (header) {
				oldLine += 1;
				newLine += 1;
			}
			return entry;
		});
		return {
			header: raw.header,
			oldStart: header?.oldStart ?? 0,
			oldLines: header?.oldLines ?? 0,
			newStart: header?.newStart ?? 0,
			newLines: header?.newLines ?? 0,
			additions,
			deletions,
			targetLine: Math.max(1, header?.newStart ?? 1),
			lines
		};
	});
}

/** Project already-parsed Git hunks into the shape `useReviewOverlay` knows how to paint. */
export function gitDiffOverlay(diff: GitFileDiff, hunks: GitHunk[]): FileReviewDiff | null {
	if (hunks.length === 0) return null;
	return {
		path: diff.path,
		changeIds: [],
		hunks: hunks.map(hunk => ({
			oldStart: hunk.oldStart,
			oldLines: hunk.oldLines,
			newStart: hunk.newStart,
			newLines: hunk.newLines,
			lines: hunk.lines
		})),
		additions: diff.additions,
		deletions: diff.deletions,
		broken: false,
		blocked: null
	};
}
