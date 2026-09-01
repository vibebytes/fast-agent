/**
 * Find a safe index to split streaming Markdown so the prefix can freeze
 * (gemini-cli Static / findLastSafeSplitPoint style).
 */
function isIndexInsideCodeBlock(content: string, indexToTest: number): boolean {
	let fenceCount = 0;
	let searchPos = 0;
	while (searchPos < content.length) {
		const nextFence = content.indexOf('```', searchPos);
		if (nextFence === -1 || nextFence >= indexToTest) break;
		fenceCount += 1;
		searchPos = nextFence + 3;
	}
	return fenceCount % 2 === 1;
}

function findEnclosingCodeBlockStart(content: string, index: number): number {
	if (!isIndexInsideCodeBlock(content, index)) return -1;
	let currentSearchPos = 0;
	while (currentSearchPos < index) {
		const blockStartIndex = content.indexOf('```', currentSearchPos);
		if (blockStartIndex === -1 || blockStartIndex >= index) break;
		const next = content.indexOf('```', blockStartIndex + 3);
		if (next === -1 || next >= index) return blockStartIndex;
		currentSearchPos = next + 3;
	}
	return -1;
}

/** Index where frozen prefix ends; remainder is the streaming tail. */
export function findLastSafeSplitPoint(content: string): number {
	const enclosingBlockStart = findEnclosingCodeBlockStart(content, content.length);
	if (enclosingBlockStart !== -1) {
		return enclosingBlockStart;
	}

	let searchStartIndex = content.length;
	while (searchStartIndex >= 0) {
		const dnlIndex = content.lastIndexOf('\n\n', searchStartIndex);
		if (dnlIndex === -1) break;
		const potentialSplitPoint = dnlIndex + 2;
		if (!isIndexInsideCodeBlock(content, potentialSplitPoint)) {
			return potentialSplitPoint;
		}
		searchStartIndex = dnlIndex - 1;
	}

	return content.length;
}

export function splitStreamingMarkdown(content: string): {frozen: string; pending: string} {
	const split = findLastSafeSplitPoint(content);
	return {
		frozen: content.slice(0, split),
		pending: content.slice(split)
	};
}
