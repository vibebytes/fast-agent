export type MediaKind = 'image' | 'video' | 'audio';

export type MediaArtifact = {
	kind: MediaKind;
	path: string;
};

const EXT: Record<MediaKind, RegExp> = {
	image: /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i,
	video: /\.(?:mp4|webm|mov)$/i,
	audio: /\.(?:mp3|wav|m4a|ogg|flac|aac)$/i
};

const PATH =
	/((?:\/|\b)(?:[\w.+@-]+\/)*[\w.+@-]+\.(?:png|jpe?g|gif|webp|bmp|svg|mp4|webm|mov|mp3|wav|m4a|ogg|flac|aac))/i;

export function mediaKindOf(filePath: string): MediaKind | null {
	const name = filePath.trim();
	for (const kind of ['video', 'audio', 'image'] as const) {
		if (EXT[kind].test(name)) return kind;
	}
	return null;
}

/** First workspace image, video, or audio path mentioned in tool output. */
export function extractMediaArtifact(
	...texts: Array<string | null | undefined>
): MediaArtifact | null {
	for (const text of texts) {
		if (!text) continue;
		const match = PATH.exec(text);
		const found = match?.[1]?.replace(/^\.\//, '');
		if (!found) continue;
		const kind = mediaKindOf(found);
		if (kind) return {kind, path: found};
	}
	return null;
}
