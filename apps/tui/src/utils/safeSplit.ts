/**
 * Markdown-safe streaming text splitter.
 *
 * While a message streams, everything before the last "safe split point"
 * (a blank line outside any fenced code block) is stable: appending more text
 * can never change how it renders. Stable chunks are committed to Ink's
 * <Static> region exactly once, so per-delta re-renders only touch the small
 * pending tail. This is the core anti-flicker mechanism, mirroring
 * gemini-cli's findLastSafeSplitPoint approach.
 *
 * Append-stability invariant (tested): for any text `t` and any extension
 * `t + suffix`, `splitStableChunks(t).chunks` is a prefix of
 * `splitStableChunks(t + suffix).chunks`.
 */

/**
 * All safe split offsets of `text`, in ascending order. An offset `p` means
 * "the chunk ends right before `p`" — `p` points at the start of content
 * after a `\n\n` boundary that is outside any fenced code block.
 */
export function findSafeSplitPoints(text: string): number[] {
	const points: number[] = [];
	const lines = text.split('\n');
	let inFence = false;
	let offset = 0;
	let blankRun = false;
	let sawContent = false;

	for (const line of lines) {
		const isBlank = line.trim().length === 0;
		if (!inFence && !isBlank && blankRun && sawContent) {
			points.push(offset);
		}
		if (!isBlank) {
			sawContent = true;
			if (line.startsWith('```')) {
				inFence = !inFence;
			}
		}
		blankRun = isBlank && !inFence;
		offset += line.length + 1;
	}

	return points;
}

export type StableSplit = {
	/** Closed chunks; their text will never change as the stream appends. */
	chunks: string[];
	/** Open tail after the last safe boundary; re-rendered while streaming. */
	tail: string;
};

export function splitStableChunks(text: string): StableSplit {
	const points = findSafeSplitPoints(text);
	if (points.length === 0) {
		return {chunks: [], tail: text};
	}
	const chunks: string[] = [];
	let start = 0;
	for (const point of points) {
		chunks.push(text.slice(start, point).trimEnd());
		start = point;
	}
	return {chunks, tail: text.slice(start)};
}
