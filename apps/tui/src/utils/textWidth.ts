/**
 * Single source of truth for terminal text width math.
 *
 * Everything that pads, truncates or estimates wrapped line counts MUST go
 * through this module so the whole UI shares one width definition with Ink's
 * internal wrapping (which is also based on `string-width`). Mixing
 * `.length`-based math with CJK/emoji content is the primary historical cause
 * of torn frames ("窜行") in this UI.
 */
import stringWidth from 'string-width';

const ANSI_PATTERN = /[\u001b\u009b][[()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~])/g;

/** Strip ANSI escape sequences (colors, cursor movement) from a string. */
export function stripAnsi(value: string): string {
	return value.replace(ANSI_PATTERN, '');
}

const WIDTH_CACHE_LIMIT = 4096;
const WIDTH_CACHE_MAX_KEY_LENGTH = 256;
const widthCache = new Map<string, number>();

/**
 * Visual terminal column width of a string (CJK = 2 columns, emoji/ZWJ
 * sequences handled by string-width, ANSI sequences = 0 columns).
 * LRU-cached for short strings with an ASCII fast path.
 */
export function visualWidth(value: string): number {
	if (value.length === 0) return 0;
	// Fast path: pure printable ASCII is always 1 column per char.
	if (isSimpleAscii(value)) return value.length;
	if (value.length <= WIDTH_CACHE_MAX_KEY_LENGTH) {
		const cached = widthCache.get(value);
		if (cached !== undefined) {
			// Refresh LRU position.
			widthCache.delete(value);
			widthCache.set(value, cached);
			return cached;
		}
	}
	const width = stringWidth(value);
	if (value.length <= WIDTH_CACHE_MAX_KEY_LENGTH) {
		if (widthCache.size >= WIDTH_CACHE_LIMIT) {
			const oldest = widthCache.keys().next().value;
			if (oldest !== undefined) widthCache.delete(oldest);
		}
		widthCache.set(value, width);
	}
	return width;
}

function isSimpleAscii(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code < 0x20 || code > 0x7e) return false;
	}
	return true;
}

let segmenter: Intl.Segmenter | undefined;

/** Split a string into grapheme clusters (safe for emoji/ZWJ/combining marks). */
export function graphemes(value: string): string[] {
	if (isSimpleAscii(value)) return value.split('');
	segmenter ??= new Intl.Segmenter(undefined, {granularity: 'grapheme'});
	return Array.from(segmenter.segment(value), segment => segment.segment);
}

/**
 * Collapse newlines into a visible `⏎` marker. truncateEnd/truncateMiddle
 * produce SINGLE terminal rows (callers pair them with `wrap="truncate"`);
 * a raw `\n` slipping through renders extra rows, blows the row budget and
 * tears bordered cards apart. The marker keeps multi-line content (shell
 * scripts in approval prompts, etc.) auditable instead of silently joined.
 */
function singleLine(value: string): string {
	return value.includes('\n') ? value.replace(/[ \t]*\n+[ \t]*/g, ' ⏎ ') : value;
}

/**
 * Truncate from the right so the visual width fits `maxWidth`, appending `…`.
 * Never splits a grapheme cluster. Always returns a single line.
 */
export function truncateEnd(value: string, maxWidth = 120): string {
	const clean = singleLine(stripAnsi(value));
	if (maxWidth <= 0) return '';
	if (visualWidth(clean) <= maxWidth) return clean;
	if (maxWidth === 1) return '…';
	const budget = maxWidth - 1;
	let result = '';
	let width = 0;
	for (const cluster of graphemes(clean)) {
		const clusterWidth = visualWidth(cluster);
		if (width + clusterWidth > budget) break;
		result += cluster;
		width += clusterWidth;
	}
	return `${result}…`;
}

/** Truncate in the middle (`abc…xyz`), grapheme-safe, width-accurate, single-line. */
export function truncateMiddle(value: string, maxWidth = 120): string {
	const clean = singleLine(stripAnsi(value));
	if (maxWidth <= 0) return '';
	if (visualWidth(clean) <= maxWidth) return clean;
	if (maxWidth <= 2) return truncateEnd(clean, maxWidth);
	const half = Math.floor((maxWidth - 1) / 2);
	const clusters = graphemes(clean);
	let left = '';
	let leftWidth = 0;
	for (const cluster of clusters) {
		const clusterWidth = visualWidth(cluster);
		if (leftWidth + clusterWidth > half) break;
		left += cluster;
		leftWidth += clusterWidth;
	}
	let right = '';
	let rightWidth = 0;
	for (let index = clusters.length - 1; index >= 0; index--) {
		const cluster = clusters[index]!;
		const clusterWidth = visualWidth(cluster);
		if (rightWidth + clusterWidth > maxWidth - 1 - leftWidth) break;
		right = cluster + right;
		rightWidth += clusterWidth;
	}
	return `${left}…${right}`;
}

/** Shorten a filesystem path to fit, preserving head and tail segments. */
export function compactPath(path: string, maxWidth = 64): string {
	return truncateMiddle(path, maxWidth);
}

/** Pad with trailing spaces until the string reaches exactly `width` columns. */
export function padToWidth(value: string, width: number): string {
	const current = visualWidth(value);
	if (current >= width) return value;
	return value + ' '.repeat(width - current);
}

/**
 * Produce a fixed-width terminal line: truncate, then pad with spaces.
 * Padding lets the next frame overwrite stale tails from the previous frame.
 */
export function fitTerminalLine(value: string, width: number): string {
	const safeWidth = Math.max(1, width);
	return padToWidth(truncateEnd(value, safeWidth), safeWidth);
}

/**
 * Count how many terminal rows a text occupies when wrapped at `width`
 * columns. Matches Ink's greedy word-wrapping closely enough for layout
 * budgeting (CJK-accurate, unlike `.length`-based estimates).
 */
export function countWrappedLines(text: string, width: number): number {
	const safeWidth = Math.max(1, width);
	let total = 0;
	for (const line of text.split('\n')) {
		total += countWrappedLine(line, safeWidth);
	}
	return total;
}

function countWrappedLine(line: string, width: number): number {
	const lineWidth = visualWidth(stripAnsi(line));
	if (lineWidth <= width) return 1;
	// Greedy word wrap approximation; oversized words wrap hard by columns.
	const words = stripAnsi(line).split(' ');
	let rows = 1;
	let column = 0;
	for (const [index, word] of words.entries()) {
		const wordWidth = visualWidth(word);
		const separator = index > 0 && column > 0 ? 1 : 0;
		if (column + separator + wordWidth <= width) {
			column += separator + wordWidth;
			continue;
		}
		if (wordWidth > width) {
			// Hard-wrap an oversized word (URLs, CJK runs without spaces):
			// the whole word moves to a fresh row and fills ceil(w/width) rows.
			if (column > 0) rows += 1;
			rows += Math.ceil(wordWidth / width) - 1;
			column = wordWidth % width || width;
			continue;
		}
		rows += 1;
		column = wordWidth;
	}
	return rows;
}

/** Keep only the last `maxLines` wrapped rows of a text (for streaming tails). */
/**
 * Hard-wrap text at `width` visual columns, splitting long unbroken lines
 * (e.g. streamed CJK reasoning paragraphs) into real rows. Needed before
 * tail-clamping by rows: `tailLines` never splits inside a logical line.
 */
export function hardWrap(text: string, width: number): string {
	const safeWidth = Math.max(1, width);
	const out: string[] = [];
	for (const rawLine of text.split('\n')) {
		// ANSI sequences must not count as columns — grapheme iteration would
		// otherwise split them into visible-width fragments.
		const line = rawLine.includes('\u001b') ? stripAnsi(rawLine) : rawLine;
		if (visualWidth(line) <= safeWidth) {
			out.push(line);
			continue;
		}
		let current = '';
		let currentWidth = 0;
		for (const cluster of graphemes(line)) {
			const clusterWidth = visualWidth(cluster);
			if (currentWidth + clusterWidth > safeWidth && current.length > 0) {
				out.push(current);
				current = '';
				currentWidth = 0;
			}
			current += cluster;
			currentWidth += clusterWidth;
		}
		if (current.length > 0) out.push(current);
	}
	return out.join('\n');
}

export function tailLines(text: string, maxLines: number, width: number): {text: string; hiddenLines: number} {
	if (maxLines <= 0) return {text: '', hiddenLines: countWrappedLines(text, width)};
	const lines = text.split('\n');
	let used = 0;
	const kept: string[] = [];
	for (let index = lines.length - 1; index >= 0; index--) {
		const cost = countWrappedLine(lines[index] ?? '', Math.max(1, width));
		if (used + cost > maxLines && kept.length > 0) {
			return {text: kept.join('\n'), hiddenLines: index + 1};
		}
		kept.unshift(lines[index] ?? '');
		used += cost;
		if (used >= maxLines) {
			return {text: kept.join('\n'), hiddenLines: index};
		}
	}
	return {text: kept.join('\n'), hiddenLines: 0};
}
