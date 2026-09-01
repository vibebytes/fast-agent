export function buildSparkline(samples: number[], width = 8): string {
	const glyphs = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
	if (samples.length === 0) {
		return '';
	}

	const max = Math.max(...samples, 1);
	const bucketSize = Math.max(1, Math.ceil(samples.length / width));
	const buckets: number[] = [];

	for (let index = 0; index < width; index += 1) {
		const start = index * bucketSize;
		const slice = samples.slice(start, start + bucketSize);
		if (slice.length === 0) {
			buckets.push(0);
			continue;
		}
		buckets.push(slice.reduce((sum, value) => sum + value, 0) / slice.length);
	}

	return buckets
		.map(value => {
			const normalized = Math.min(glyphs.length - 1, Math.floor((value / max) * (glyphs.length - 1)));
			return glyphs[normalized];
		})
		.join('');
}

export function computeTokenRate(samples: Array<{timestamp: number; tokens: number}>, windowMs = 10_000): number {
	const now = Date.now();
	const recent = samples.filter(sample => now - sample.timestamp <= windowMs);
	if (recent.length < 2) {
		return 0;
	}
	const first = recent[0];
	const last = recent.at(-1);
	if (!first || !last) {
		return 0;
	}
	const deltaTokens = Math.max(0, last.tokens - first.tokens);
	const deltaMs = Math.max(1, last.timestamp - first.timestamp);
	return Math.round((deltaTokens / deltaMs) * 1000);
}
