/** Incremental UTF-8. Socket/stdio `data` chunks can split a 3-byte CJK
 *  sequence; `String(chunk)` / `Buffer.toString('utf8')` replace the orphan
 *  bytes with U+FFFD and the conversation shows 「��」. */
export function utf8Stream(): (chunk: Buffer | Uint8Array | string) => string {
	const decoder = new TextDecoder('utf-8');
	return chunk => (typeof chunk === 'string' ? chunk : decoder.decode(chunk, {stream: true}));
}

/**
 * One NDJSON stream. Incomplete input stays as chunks and is joined only when
 * a newline arrives, so a multi-megabyte line does not recopy itself on every
 * socket read.
 */
export function ndjsonLines(onLine: (line: string) => void): (chunk: string) => void {
	const frame = new Frame();
	return chunk => frame.push(chunk, onLine);
}

/** Stateless wrapper. Callers that feed the returned remainder back in recopy the whole line. */
export function parseNdjsonChunk(
	previous: string,
	chunk: string,
	onLine: (line: string) => void
): string {
	const frame = new Frame();
	frame.push(previous, onLine);
	frame.push(chunk, onLine);
	return frame.remainder();
}

class Frame {
	private parts: string[] = [];
	/** A trailing `\r` might be the start of `\r\n` in the next chunk. */
	private heldCr = false;

	push(chunk: string, onLine: (line: string) => void): void {
		if (chunk.length === 0) return;
		let s = chunk;
		if (this.heldCr) {
			this.heldCr = false;
			if (s.charCodeAt(0) === 10) {
				this.emit(onLine);
				s = s.slice(1);
			} else {
				this.parts.push('\r');
			}
		}
		let start = 0;
		for (let i = 0; i < s.length; i++) {
			if (s.charCodeAt(i) !== 10) continue;
			const fromCr = i > start && s.charCodeAt(i - 1) === 13;
			this.take(s.slice(start, fromCr ? i - 1 : i));
			this.emit(onLine);
			start = i + 1;
		}
		const rest = s.slice(start);
		if (rest.endsWith('\r')) {
			this.take(rest.slice(0, -1));
			this.heldCr = true;
		} else {
			this.take(rest);
		}
	}

	remainder(): string {
		const body = this.parts.length === 0 ? '' : this.parts.length === 1 ? this.parts[0]! : this.parts.join('');
		return this.heldCr ? `${body}\r` : body;
	}

	private take(s: string): void {
		if (s.length > 0) this.parts.push(s);
	}

	private emit(onLine: (line: string) => void): void {
		if (this.parts.length === 0) return;
		const line = this.parts.length === 1 ? this.parts[0]! : this.parts.join('');
		this.parts.length = 0;
		const trimmed = line.trim();
		if (trimmed.length > 0) onLine(trimmed);
	}
}
