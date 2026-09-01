/**
 * Session visual plane — expected chrome class literals (docs/styling.md).
 * Tests assert these appear as static strings in scanned component/renderer files.
 * Do not import these into runtime className — put the literals in the component.
 */
export const WINDOW_FRAME_SOFT_CHROME = {
	headerBg: 'bg-muted/15',
	headerHover: 'hover:bg-muted/30',
	border: 'border-border/50'
} as const;

export const TOOL_COMMAND_SECTION_BORDER = WINDOW_FRAME_SOFT_CHROME.border;

export const MARKDOWN_SHIKI_TRANSPARENT_SELECTORS = [
	'.markdown-shiki pre',
	'.markdown-shiki code',
	'.markdown-shiki .shiki',
	'.markdown-shiki .shiki span'
] as const;
