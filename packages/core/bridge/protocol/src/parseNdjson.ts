/** Incremental UTF-8. Socket/stdio `data` chunks can split a 3-byte CJK
 *  sequence; `String(chunk)` / `Buffer.toString('utf8')` replace the orphan
 *  bytes with U+FFFD and the conversation shows 「��」. */
export function utf8Stream(): (chunk: Buffer | Uint8Array | string) => string {
	const decoder = new TextDecoder('utf-8');
	return chunk => (typeof chunk === 'string' ? chunk : decoder.decode(chunk, {stream: true}));
}

export function parseNdjsonChunk(
	previous: string,
	chunk: string,
	onLine: (line: string) => void
): string {
	const combined = previous + chunk;
	const lines = combined.split(/\r?\n/);
	const remainder = lines.pop() ?? '';

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length > 0) {
			onLine(trimmed);
		}
	}

	return remainder;
}
