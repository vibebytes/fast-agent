/**
 * Which Document tabs can switch Source / Preview.
 *
 * Markdown, HTML, and SVG are the formats whose source is not the reading
 * surface. Vue/Svelte stay source-only: Monaco treats them as HTML, but a
 * markup preview would lie about the compiled page.
 */

export type DocumentPreviewKind = 'markdown' | 'html' | 'svg';

const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdown', 'mdx']);
const HTML_EXT = new Set(['html', 'htm']);
const SVG_EXT = new Set(['svg']);

export function documentPreviewKind(filePath?: string | null): DocumentPreviewKind | null {
	if (!filePath) return null;
	const base = filePath.split(/[/\\]/).pop() ?? filePath;
	const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : '';
	if (MARKDOWN_EXT.has(ext)) return 'markdown';
	if (HTML_EXT.has(ext)) return 'html';
	if (SVG_EXT.has(ext)) return 'svg';
	return null;
}
