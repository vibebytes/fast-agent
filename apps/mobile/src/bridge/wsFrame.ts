/** Normalize a WebSocket message payload to text. RN may deliver a string or bytes. */
export function wsFrameText(data: unknown): string | null {
	if (typeof data === 'string') return data;
	if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
	if (ArrayBuffer.isView(data)) {
		return new TextDecoder().decode(data);
	}
	return null;
}
