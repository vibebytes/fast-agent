/** Product window for open Thought / Exploring Live Ticker (spec Q1). */
export const LIVE_TICKER_ROWS = 3;

/** Matches `leading-5` / text-[12px] thought body. */
export const LIVE_TICKER_LINE_HEIGHT_PX = 20;

/** Trigger row + padding above the ticker body. */
const LIVE_TICKER_CHROME_PX = 36;

export type TickerLine = {key: number; text: string};

/**
 * Take up to `maxLines` non-empty logical lines from the end of `text`.
 * Scans backward so a huge reasoning buffer stays O(tail), not O(full split).
 * `key` is the character offset of the line start (stable across streaming frames).
 */
export function tickerTailLines(
	text: string,
	maxLines: number,
	maxCharsPerLine = 160
): TickerLine[] {
	if (maxLines <= 0 || text.length === 0) return [];

	const raw: Array<{key: number; text: string}> = [];
	let end = text.length;
	while (end > 0 && (text.charCodeAt(end - 1) === 10 || text.charCodeAt(end - 1) === 13)) {
		end -= 1;
	}

	while (end > 0 && raw.length < maxLines) {
		let start = end;
		while (start > 0 && text.charCodeAt(start - 1) !== 10) start -= 1;
		let line = text.slice(start, end);
		if (line.endsWith('\r')) line = line.slice(0, -1);
		const trimmed = line.trim();
		if (trimmed.length > 0 && !/^\.+$/.test(trimmed)) {
			const display =
				trimmed.length > maxCharsPerLine
					? `…${trimmed.slice(-(maxCharsPerLine - 1))}`
					: trimmed;
			raw.push({key: start, text: display});
		}
		end = start > 0 ? start - 1 : 0;
		if (start === 0) break;
	}

	raw.reverse();
	return raw;
}

/** Newest explore tool rows as ticker lines (`key` = tool index). */
export function exploreTickerLines(
	tools: ReadonlyArray<{title: string; summary: string | null}>,
	maxLines: number
): TickerLine[] {
	if (maxLines <= 0 || tools.length === 0) return [];
	const start = Math.max(0, tools.length - maxLines);
	const out: TickerLine[] = [];
	for (let i = start; i < tools.length; i++) {
		const t = tools[i]!;
		const title = t.title.trim();
		const summary = t.summary?.trim() ?? '';
		const text =
			!summary || summary === title || title.includes(summary)
				? title
				: `${title} — ${summary}`;
		out.push({key: i, text});
	}
	return out;
}

/** Fixed outer height budget for an open Live Ticker (trigger + N rows). */
export function liveTickerOuterHeightPx(rows: number = LIVE_TICKER_ROWS): number {
	return LIVE_TICKER_CHROME_PX + rows * LIVE_TICKER_LINE_HEIGHT_PX;
}

/**
 * Live ticker vs full body: only while the item is still open (streaming) and
 * the user has not overridden the default open chrome (`userOpen === null`).
 */
export function shouldUseLiveTicker(args: {
	itemOpen: boolean;
	userOpen: boolean | null;
}): boolean {
	return args.itemOpen && args.userOpen === null;
}

/** Collapsible `open` for Thought/Exploring chrome. */
export function auxiliaryChromeOpen(args: {
	itemOpen: boolean;
	userOpen: boolean | null;
}): boolean {
	return args.itemOpen ? args.userOpen !== false : Boolean(args.userOpen);
}

/**
 * Exploring full tool list mounts only when the collapsible chrome is open and
 * we are not on the live-ticker path (user-forced expand or sealed+expanded).
 */
export function shouldMountExploringFullList(args: {
	itemOpen: boolean;
	userOpen: boolean | null;
}): boolean {
	return auxiliaryChromeOpen(args) && !shouldUseLiveTicker(args);
}

/**
 * Streaming chrome click: ticker ↔ full body; sealed chrome uses plain boolean.
 * Collapsing full body while still open returns to ticker (`userOpen = null`).
 */
export function nextAuxiliaryUserOpen(args: {
	itemOpen: boolean;
	userOpen: boolean | null;
	requestedOpen: boolean;
}): boolean | null {
	if (!args.itemOpen) return args.requestedOpen;
	if (args.userOpen === true) return null;
	if (args.userOpen === null) return true;
	return null;
}
