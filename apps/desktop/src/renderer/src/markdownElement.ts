/**
 * Element-level markdown cache (tab-switch perf, follow-up to the tail window).
 *
 * react-markdown v10's `Markdown(options)` is a plain hook-free function that
 * runs the whole remark parse at call time and returns an immutable element
 * tree. Calling it directly and caching the element makes a re-mount of the
 * same message skip the parse entirely — output is byte-identical because it
 * is literally the same function react-markdown uses as a component.
 *
 * Only stable variants are cached (transcript bodies at rest). Streaming text
 * changes every frame and would churn the LRU for nothing.
 */
import type {ReactElement} from 'react';
import ReactMarkdown, {type Options} from 'react-markdown';

const cache = new Map<string, ReactElement>();
const CACHE_MAX = 80;

export function markdownElement(
	options: Readonly<Options>,
	cacheKey: string | null
): ReactElement {
	if (cacheKey !== null) {
		const hit = cache.get(cacheKey);
		if (hit !== undefined) {
			// Refresh LRU position.
			cache.delete(cacheKey);
			cache.set(cacheKey, hit);
			return hit;
		}
	}
	const element = ReactMarkdown(options);
	if (cacheKey !== null) {
		cache.set(cacheKey, element);
		if (cache.size > CACHE_MAX) {
			const oldest = cache.keys().next().value;
			if (oldest !== undefined) cache.delete(oldest);
		}
	}
	return element;
}

export function __markdownCacheSizeForTests(): number {
	return cache.size;
}

export function __resetMarkdownCacheForTests(): void {
	cache.clear();
}
