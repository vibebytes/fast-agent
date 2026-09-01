import {
	createHighlighter,
	type BundledLanguage,
	type Highlighter
} from 'shiki';

const THEMES = ['github-light', 'github-dark'] as const;

const LANG_ALIASES: Record<string, string> = {
	js: 'javascript',
	ts: 'typescript',
	jsx: 'jsx',
	tsx: 'tsx',
	py: 'python',
	sh: 'bash',
	shell: 'bash',
	zsh: 'bash',
	yml: 'yaml',
	md: 'markdown',
	rs: 'rust',
	cs: 'csharp',
	'c#': 'csharp',
	cpp: 'cpp',
	'c++': 'cpp',
	scala: 'scala',
	sc: 'scala',
	java: 'java',
	go: 'go',
	golang: 'go',
	sql: 'sql',
	html: 'html',
	css: 'css',
	json: 'json',
	jsonc: 'jsonc',
	diff: 'diff',
	patch: 'diff',
	dockerfile: 'dockerfile',
	docker: 'dockerfile',
	plaintext: 'plaintext',
	text: 'plaintext',
	txt: 'plaintext'
};

/**
 * Boot set only (perf doc P2-10): highlightCode already lazy-loads any other
 * grammar on first use — preloading languages keeps the first highlight fast.
 */
const PRELOAD_LANGS = [
	'javascript',
	'typescript',
	'json',
	'bash',
	'python',
	'scala',
	'markdown',
	'plaintext'
] as const;

let highlighterPromise: Promise<Highlighter> | null = null;
const highlightCache = new Map<string, string>();
const HIGHLIGHT_CACHE_MAX = 128;

export function resolveLang(language?: string): string {
	if (!language) return 'plaintext';
	const key = language.trim().toLowerCase();
	return LANG_ALIASES[key] ?? key;
}

/**
 * Smart detection for code blocks where language tag is missing or generic (e.g. ```code).
 */
export function detectLanguage(code: string, language?: string): string {
	const trimmed = language?.trim().toLowerCase();
	if (trimmed && trimmed !== 'code' && trimmed !== 'snippet' && trimmed !== 'plaintext' && trimmed !== 'text') {
		return resolveLang(trimmed);
	}
	// Heuristics for common languages without an explicit tag:
	// Scala:
	if (/\b(?:case\s+\w+|def\s+\w+|val\s+\w+|var\s+\w+|enum\s+\w+|summon\[|sealed\s+trait|given\s+|extension\s*\()\b/.test(code)) {
		return 'scala';
	}
	// TypeScript / JavaScript:
	if (/\b(?:const\s+\w+|let\s+\w+|console\.(?:log|error|warn)|import\s+.*?from|export\s+(?:function|const|default|type)|interface\s+\w+|type\s+\w+\s*=)\b/.test(code) || /=>\s*\{?/.test(code)) {
		return 'typescript';
	}
	// Python:
	if (/\b(?:def\s+\w+\s*\(|elif\s+|import\s+\w+|from\s+\w+\s+import|class\s+\w+.*?:|print\s*\()/.test(code)) {
		return 'python';
	}
	// Shell / Bash:
	if (/^\s*(?:\$\s+|#!\/bin\/(?:bash|sh|zsh)|curl\s+|git\s+|cd\s+|npm\s+|pnpm\s+|cargo\s+|export\s+\w+=)/m.test(code)) {
		return 'bash';
	}
	// JSON:
	if (/^\s*[\{\[][\s\S]*[\}\]]\s*$/.test(code) && /"\w+"\s*:/.test(code)) {
		return 'json';
	}
	// SQL:
	if (/\b(?:SELECT\s+.*?FROM|INSERT\s+INTO|UPDATE\s+.*?SET|DELETE\s+FROM|CREATE\s+TABLE)\b/i.test(code)) {
		return 'sql';
	}
	return 'plaintext';
}

const DISPLAY_NAMES: Record<string, string> = {
	typescript: 'TypeScript',
	ts: 'TypeScript',
	javascript: 'JavaScript',
	js: 'JavaScript',
	jsx: 'React JSX',
	tsx: 'React TSX',
	python: 'Python',
	py: 'Python',
	scala: 'Scala',
	sc: 'Scala',
	java: 'Java',
	rust: 'Rust',
	rs: 'Rust',
	go: 'Go',
	golang: 'Go',
	bash: 'Bash',
	sh: 'Shell',
	shell: 'Shell',
	zsh: 'Zsh',
	json: 'JSON',
	jsonc: 'JSON with Comments',
	yaml: 'YAML',
	yml: 'YAML',
	markdown: 'Markdown',
	md: 'Markdown',
	sql: 'SQL',
	html: 'HTML',
	css: 'CSS',
	csharp: 'C#',
	cs: 'C#',
	'c#': 'C#',
	cpp: 'C++',
	'c++': 'C++',
	dockerfile: 'Dockerfile',
	docker: 'Dockerfile',
	diff: 'Diff',
	patch: 'Patch',
	plaintext: 'Text'
};

export function displayLanguageName(language: string | undefined, detectedLang?: string): string {
	const effective = (language && language !== 'code' && language !== 'snippet' ? language : detectedLang) ?? 'code';
	const key = effective.trim().toLowerCase();
	return DISPLAY_NAMES[key] ?? (effective.charAt(0).toUpperCase() + effective.slice(1));
}

export function highlightCacheKey(code: string, language?: string): string {
	return `${detectLanguage(code, language)}\0${code}`;
}

export function __resetHighlightCacheForTests(): void {
	highlightCache.clear();
}

export function __highlightCacheSizeForTests(): number {
	return highlightCache.size;
}

function getHighlighter(): Promise<Highlighter> {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: [...THEMES],
			langs: [...PRELOAD_LANGS]
		});
	}
	return highlighterPromise;
}

/** Synchronous cache peek — lets a re-mount render highlighted HTML on first paint. */
export function highlightCodeCached(code: string, language?: string): string | null {
	return highlightCache.get(highlightCacheKey(code, language)) ?? null;
}

/** Highlight code to dual-theme HTML (light/dark CSS vars). Falls back to escaped plain pre. */
export async function highlightCode(code: string, language?: string): Promise<string> {
	const cacheKey = highlightCacheKey(code, language);
	const cached = highlightCache.get(cacheKey);
	if (cached !== undefined) return cached;

	const lang = resolveLang(language);
	let html: string;
	try {
		const highlighter = await getHighlighter();
		const loaded = highlighter.getLoadedLanguages();
		if (!loaded.includes(lang as BundledLanguage)) {
			try {
				await highlighter.loadLanguage(lang as BundledLanguage);
			} catch {
				html = escapeAsPre(code);
				rememberHighlight(cacheKey, html);
				return html;
			}
		}
		html = highlighter.codeToHtml(code, {
			lang: lang as BundledLanguage,
			themes: {
				light: 'github-light',
				dark: 'github-dark'
			},
			defaultColor: false
		});
	} catch {
		html = escapeAsPre(code);
	}
	rememberHighlight(cacheKey, html);
	return html;
}

function rememberHighlight(key: string, html: string): void {
	highlightCache.set(key, html);
	if (highlightCache.size <= HIGHLIGHT_CACHE_MAX) return;
	const oldest = highlightCache.keys().next().value;
	if (oldest !== undefined) highlightCache.delete(oldest);
}

function escapeAsPre(code: string): string {
	const escaped = code
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
	return `<pre class="shiki"><code>${escaped}</code></pre>`;
}
