import {shellT as t} from './i18n/t';
import {memo, createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {splitStreamingMarkdown} from '@fast-ide/session-view';
import {Button} from '@fast-ide/ui/components/button';
import {WindowFrame} from '@fast-ide/ui/components/window-frame';
import {cn} from '@fast-ide/ui/lib/utils';
import {Check, Copy, ImageOff} from 'lucide-react';
import {type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
	detectLanguage,
	displayLanguageName,
	highlightCode,
	highlightCodeCached
} from './highlightCode';
import {markdownElement} from './markdownElement';
import {mentionizeTree} from './MentionText';

export const OpenFileContext = createContext<
	((path: string, line?: number, endLine?: number) => void) | undefined
>(undefined);

type CodeBlockProps = {
	code: string;
	language?: string;
};

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i;

const FILE_EXTS =
	'ts|tsx|js|jsx|mjs|cjs|scala|sc|sbt|py|rs|go|java|kt|kts|c|cpp|cc|cxx|h|hpp|cs|json|jsonc|yaml|yml|toml|md|markdown|sql|sh|bash|zsh|css|scss|less|html|htm|xml|svg|dockerfile';

// Match deterministic code/config file paths with optional line numbers:
// e.g. "WorkspaceDisk.scala:188-191", "WorkspaceDisk.scala:175、205", "RightWorkbench.tsx:325", "agent/.../file.scala"
const FILE_REF_RE = new RegExp(
	`^((?:@?[a-zA-Z0-9_.-]+[\\/\\\\]|\\.{1,2}[\\/\\\\]|[\\/\\\\])*[a-zA-Z0-9_.-]+\\.(?:${FILE_EXTS}))(?:[:#](?:L|line\\s*)?(\\d+)(?:[\\s,、–—-]|(?:[-–—:–,、]|\\s*[,、]\\s*)(?:L|line\\s*)?(\\d+))?)?$`,
	'i'
);

type ParsedFileRef = {
	filePath: string;
	startLine?: number;
	endLine?: number;
	rawText?: string;
};

export function parseFileRef(text: string): ParsedFileRef | null {
	const trimmed = text.trim();
	if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return null;
	const match = FILE_REF_RE.exec(trimmed);
	if (!match) return null;
	const filePath = match[1];
	if (!filePath) return null;
	const startLine = match[2] ? parseInt(match[2], 10) : undefined;
	const endLine = match[3] ? parseInt(match[3], 10) : undefined;
	return {
		filePath,
		startLine,
		endLine,
		rawText: trimmed
	};
}

const FILE_REF_STYLE =
	'rounded-[4px] bg-[#007AFF]/10 px-1.5 py-[1px] font-mono text-[0.86em] font-semibold tracking-tight text-[#007AFF] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF] break-all';

function FileRefChip({filePath, startLine, endLine, rawText}: ParsedFileRef) {
	const onOpenFile = useContext(OpenFileContext);
	const lineSuffix = startLine
		? endLine && endLine !== startLine
			? `:${startLine}-${endLine}`
			: `:${startLine}`
		: '';

	const displayLabel = rawText || `${filePath}${lineSuffix}`;

	if (!onOpenFile) {
		return (
			<code className={cn('box-decoration-clone inline align-baseline', FILE_REF_STYLE)}>
				{displayLabel}
			</code>
		);
	}

	return (
		<button
			type="button"
			className={cn(
				'box-decoration-clone inline cursor-pointer align-baseline outline-none',
				'hover:underline underline-offset-2',
				FILE_REF_STYLE
			)}
			onClick={e => {
				e.preventDefault();
				e.stopPropagation();
				onOpenFile(filePath, startLine, endLine);
			}}
		>
			{displayLabel}
		</button>
	);
}

/** Privileged scheme handled in main — streams files, no multi‑MB IPC. */
export function toProjectMediaUrl(src: string): string {
	return `fast-ide-media://local/?p=${encodeURIComponent(src.trim())}`;
}

/** Resolve markdown / tool image src to a loadable URL (http or project media). */
export async function resolveImageSrc(src: string): Promise<string | null> {
	const trimmed = src.trim();
	if (!trimmed) return null;
	if (/^(https?:|data:|blob:|fast-ide-media:)/i.test(trimmed)) return trimmed;

	// Prefer protocol URL (works for large PNGs; avoids IPC base64 limits).
	return toProjectMediaUrl(trimmed);
}

export function ProjectImage({
	src,
	alt,
	className
}: {
	src?: string;
	alt?: string;
	className?: string;
}) {
	const [url, setUrl] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setUrl(null);
		setFailed(false);
		if (!src?.trim()) {
			setFailed(true);
			return;
		}
		void resolveImageSrc(src).then(next => {
			if (cancelled) return;
			if (next) setUrl(next);
			else setFailed(true);
		});
		return () => {
			cancelled = true;
		};
	}, [src]);

	if (failed) {
		return (
			<span className="my-2 inline-flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground">
				<ImageOff className="size-3.5 shrink-0" aria-hidden />
				{alt?.trim() || src || 'Image unavailable'}
			</span>
		);
	}

	if (!url) {
		return (
			<span className="my-2 block text-xs text-muted-foreground">Loading image…</span>
		);
	}

	return (
		<img
			src={url}
			alt={alt ?? ''}
			onError={() => setFailed(true)}
			className={cn(
				'my-2 max-h-[28rem] max-w-full rounded-md border border-border object-contain',
				className
			)}
		/>
	);
}

/** Pull first project-relative (or absolute) image path from tool output / summary text. */
export function extractImagePath(text: string | null | undefined): string | null {
	if (!text) return null;
	const patterns = [
		/(?:^|\n)\s*path:\s*([^\s\n]+\.(?:png|jpe?g|gif|webp|bmp|svg))/i,
		/(?:saved to|wrote|written to|generated)\s+[`']?([^\s`'\n]+\.(?:png|jpe?g|gif|webp|bmp|svg))/i,
		/(file:\/\/[^\s\n]+\.(?:png|jpe?g|gif|webp|bmp|svg))/i,
		/(\/(?:Users|home|tmp|var|opt)\/[^\s\n]+\.(?:png|jpe?g|gif|webp|bmp|svg))/i,
		/\b((?:[\w.-]+\/)+[\w.-]+\.(?:png|jpe?g|gif|webp|bmp|svg))\b/i
	];
	for (const re of patterns) {
		const m = re.exec(text);
		if (m?.[1] && IMAGE_EXT.test(m[1])) return m[1].replace(/^\.\//, '');
	}
	return null;
}

function looksLikeDiff(language: string | undefined, code: string): boolean {
	if (language === 'diff' || language === 'patch') return true;
	const lines = code.split('\n').slice(0, 40);
	const markers = lines.filter(l => /^[+-](?![+-]{2})/.test(l) || l.startsWith('@@ ')).length;
	return markers >= 2;
}

function DiffBody({code}: {code: string}) {
	return (
		<div className="max-h-80 overflow-auto font-mono text-[12px] leading-5">
			{code.split('\n').map((line, i) => {
				const isAdd = line.startsWith('+') && !line.startsWith('+++');
				const isDel = line.startsWith('-') && !line.startsWith('---');
				const isHunk = line.startsWith('@@');
				return (
					<div
						key={i}
						className={cn(
							'whitespace-pre-wrap break-all px-3 py-0.5',
							isAdd && 'bg-emerald-500/10 text-emerald-950 dark:text-emerald-100',
							isDel && 'bg-red-500/10 text-red-950 dark:text-red-100',
							isHunk && 'bg-muted/50 text-muted-foreground'
						)}
					>
						{line.length === 0 ? ' ' : line}
					</div>
				);
			})}
		</div>
	);
}

function HighlightedCode({code, language}: CodeBlockProps) {
	const effectiveLang = useMemo(() => detectLanguage(code, language), [code, language]);
	// Warm Shiki cache (backfill / revisit re-mounts): render highlighted HTML
	// on the very first pass — no plain→highlighted double render.
	const [html, setHtml] = useState<string | null>(() =>
		highlightCodeCached(code, effectiveLang)
	);

	useEffect(() => {
		const hit = highlightCodeCached(code, effectiveLang);
		if (hit !== null) {
			setHtml(hit);
			return;
		}
		let cancelled = false;
		setHtml(null);
		void highlightCode(code, effectiveLang).then(next => {
			if (!cancelled) setHtml(next);
		});
		return () => {
			cancelled = true;
		};
	}, [code, effectiveLang]);

	const plain = (
		<pre className="max-h-80 overflow-auto px-3.5 py-2.5 font-mono text-[12px] leading-5 whitespace-pre-wrap break-all text-foreground/90">
			{code}
		</pre>
	);

	if (!html) return plain;

	// Stack plain + highlighted in one grid cell so swap keeps the same box size.
	return (
		<div className="grid max-h-80 overflow-auto [&>*]:col-start-1 [&>*]:row-start-1 [&>*]:max-h-80 [&>*]:overflow-auto">
			<pre
				aria-hidden
				className="invisible px-3.5 py-2.5 font-mono text-[12px] leading-5 whitespace-pre-wrap break-all"
			>
				{code}
			</pre>
			<div
				className="markdown-shiki [&_pre]:m-0 [&_pre]:bg-transparent! [&_pre]:px-3.5 [&_pre]:py-2.5 [&_pre]:text-[12px] [&_pre]:leading-5 [&_pre]:whitespace-pre-wrap [&_pre]:break-all [&_code]:font-mono [&_code]:text-[12px] [&_code]:leading-5"
				dangerouslySetInnerHTML={{__html: html}}
			/>
		</div>
	);
}

function PlainCode({code}: {code: string}) {
	return (
		<pre className="max-h-80 overflow-auto px-3.5 py-2.5 font-mono text-[12px] leading-5 whitespace-pre-wrap break-all text-foreground/90">
			{code}
		</pre>
	);
}

function CodeBlock({
	code,
	language,
	deferHighlight
}: CodeBlockProps & {deferHighlight?: boolean}) {
	const [copied, setCopied] = useState(false);
	const asDiff = looksLikeDiff(language, code);
	const detected = useMemo(() => (asDiff ? 'diff' : detectLanguage(code, language)), [asDiff, code, language]);
	const displayTitle = useMemo(() => (asDiff ? 'Diff' : displayLanguageName(language, detected)), [asDiff, language, detected]);

	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		} catch {
			/* ignore */
		}
	}

	return (
		<WindowFrame
			variant="editor"
			title={
				<span className="inline-flex items-center gap-1.5 font-medium text-foreground/90">
					<span>{displayTitle}</span>
				</span>
			}
			trailing={
				<Button
					type="button"
					variant="ghost"
					size="xs"
					className={cn(
						'h-6 cursor-pointer gap-1 px-2 text-[11px] font-medium transition-all',
						'border border-border/40 bg-background/80 hover:bg-background hover:text-foreground shadow-2xs',
						copied && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
					)}
					aria-label={t('shell.markdown.copyCode')}
					onClick={() => void copy()}
				>
					{copied ? (
						<>
							<Check className="size-3 text-emerald-600 dark:text-emerald-400" />
							<span>Copied</span>
						</>
					) : (
						<>
							<Copy className="size-3" />
							<span>Copy</span>
						</>
					)}
				</Button>
			}
			bodyClassName="bg-muted/[0.08] dark:bg-muted/[0.05]"
			className="my-2.5 w-full border border-border/60 shadow-2xs rounded-lg"
		>
			{asDiff ? (
				<DiffBody code={code} />
			) : deferHighlight ? (
				// Streaming fence (perf doc P2-10): every token grew the code and
				// re-ran Shiki on the main thread — highlight once when it closes.
				<PlainCode code={code} />
			) : (
				<HighlightedCode code={code} language={detected} />
			)}
		</WindowFrame>
	);
}

function extractText(node: ReactNode): string {
	if (node == null || typeof node === 'boolean') return '';
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	if (Array.isArray(node)) return node.map(extractText).join('');
	if (typeof node === 'object' && 'props' in node) {
		const props = (node as {props?: {children?: ReactNode}}).props;
		return extractText(props?.children);
	}
	return '';
}

const REMARK_PLUGINS = [remarkGfm];

function cleanMarkdownText(text: string): string {
	return text
		.replace(/`\s+([，。！？；：、）》】])/g, '`$1')
		.replace(/([（《【])\s+`/g, '$1`');
}

/**
 * Component maps are module-level (4 variants) so the markdown element for a
 * given text is deterministic and safe to cache across mounts.
 */
function buildComponents(deferCodeHighlight: boolean, streamingTail: boolean): Components {
	const pRenderer = streamingTail
		? ({children}: {children?: ReactNode}) => (
				<p>
					{mentionizeTree(children)}
					<span className="streaming-cursor" aria-hidden />
				</p>
			)
		: ({children}: {children?: ReactNode}) => <p>{mentionizeTree(children)}</p>;
	return {
		p: pRenderer,
		li: ({children}) => <li>{mentionizeTree(children)}</li>,
		td: ({children}) => <td>{mentionizeTree(children)}</td>,
		th: ({children}) => <th>{mentionizeTree(children)}</th>,
		blockquote: ({children}) => <blockquote>{mentionizeTree(children)}</blockquote>,
		h1: ({children}) => <h1>{mentionizeTree(children)}</h1>,
		h2: ({children}) => <h2>{mentionizeTree(children)}</h2>,
		h3: ({children}) => <h3>{mentionizeTree(children)}</h3>,
		strong: ({children}) => <strong>{mentionizeTree(children)}</strong>,
		em: ({children}) => <em>{mentionizeTree(children)}</em>,
		a: ({href, children}) => (
			<a href={href} target="_blank" rel="noreferrer noopener">
				{mentionizeTree(children)}
			</a>
		),
		img: ({src, alt}) => <ProjectImage src={src} alt={alt} />,
		code: ({className: codeClass, children}) => {
			const textContent = extractText(children).replace(/\n$/, '');
			const match = /language-([\w+-]+)/.exec(codeClass ?? '');
			const isBlock = Boolean(codeClass?.includes('language-')) || textContent.includes('\n');
			if (!isBlock) {
				const fileRef = parseFileRef(textContent);
				if (fileRef) {
					return (
						<FileRefChip
							filePath={fileRef.filePath}
							startLine={fileRef.startLine}
							endLine={fileRef.endLine}
							rawText={fileRef.rawText}
						/>
					);
				}
				return (
					<code className="rounded-md border border-border/40 bg-muted/50 px-1.5 py-[1px] font-mono text-[0.86em] font-medium tracking-tight text-foreground/95">
						{children}
					</code>
				);
			}
			return (
				<CodeBlock
					code={textContent}
					language={match?.[1]}
					deferHighlight={deferCodeHighlight}
				/>
			);
		},
		pre: ({children}) => <>{children}</>
	};
}

const componentMaps = new Map<string, Components>();

function componentsFor(deferCodeHighlight: boolean, streamingTail: boolean): Components {
	const key = `${deferCodeHighlight}:${streamingTail}`;
	let map = componentMaps.get(key);
	if (!map) {
		map = buildComponents(deferCodeHighlight, streamingTail);
		componentMaps.set(key, map);
	}
	return map;
}

export function MarkdownMessage({
	text,
	className,
	deferCodeHighlight = false,
	streamingTail = false
}: {
	text: string;
	className?: string;
	/** Streaming tail: render code blocks plain — highlight when the fence closes. */
	deferCodeHighlight?: boolean;
	/** Append a blinking cursor to the last paragraph (streaming live tail). */
	streamingTail?: boolean;
}) {
	const cleaned = useMemo(() => cleanMarkdownText(text), [text]);
	// At-rest transcript bodies are cacheable: re-mounting the same message on a
	// tab switch / backfill skips the remark parse entirely. Streaming variants
	// change per frame and are parsed fresh (same as before).
	const cacheable = !deferCodeHighlight && !streamingTail;
	const content = useMemo(
		() =>
			markdownElement(
				{
					children: cleaned,
					remarkPlugins: REMARK_PLUGINS,
					components: componentsFor(deferCodeHighlight, streamingTail)
				},
				cacheable ? cleaned : null
			),
		[cleaned, deferCodeHighlight, streamingTail, cacheable]
	);

	return (
		<div
			className={cn(
				'markdown-message w-full max-w-none text-[13.5px] leading-[1.65] tracking-[-0.006em] text-foreground',
				'[&>:first-child]:mt-0 [&>:last-child]:mb-0',
				'[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5',
				'[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
				'[&_strong]:font-semibold [&_strong]:text-foreground',
				'[&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline',
				'[&_blockquote]:my-3 [&_blockquote]:rounded-r-md [&_blockquote]:border-l-[3px] [&_blockquote]:border-primary/40 [&_blockquote]:bg-muted/20 [&_blockquote]:py-1.5 [&_blockquote]:pl-3.5 [&_blockquote]:pr-3 [&_blockquote]:text-muted-foreground',
				'[&_h1]:mb-2.5 [&_h1]:mt-5 [&_h1]:text-[16px] [&_h1]:font-semibold [&_h1]:leading-6 [&_h1]:tracking-tight [&_h1]:text-foreground',
				'[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-[14.5px] [&_h2]:font-semibold [&_h2]:leading-snug [&_h2]:text-foreground',
				'[&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:text-[13.5px] [&_h3]:font-semibold [&_h3]:text-foreground',
				'[&_hr]:my-4 [&_hr]:border-border/70',
				'[&_table]:my-3 [&_table]:w-full [&_table]:text-[12.5px] [&_table]:tracking-normal',
				'[&_th]:border [&_th]:border-border/70 [&_th]:bg-muted/40 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold',
				'[&_td]:border [&_td]:border-border/70 [&_td]:px-2.5 [&_td]:py-1.5',
				className
			)}
		>
			{content}
		</div>
	);
}

const FrozenMarkdownBlock = memo(function FrozenMarkdownBlock({text}: {text: string}) {
	return <MarkdownMessage text={text} />;
});

/**
 * rAF-throttle streaming text so react-markdown parses at most once per frame.
 * Coalesced IPC patches can arrive faster than 60fps; without throttling each
 * patch triggers a full markdown AST parse + reconcile on the pending tail.
 *
 * Typewriter mode: instead of jumping to the latest text every frame (which
 * makes chunks appear), reveal characters at a steady speed so the text looks
 * like it is being typed. The reveal speed auto-scales to keep up with the
 * incoming token rate — it never falls more than one burst behind.
 */
const TYPEWRITER_CHARS_PER_MS = 0.18; // ~11 chars/frame at 60fps
const TYPEWRITER_MAX_LAG = 240; // chars; if further behind, jump to avoid drift

function useStreamingText(text: string, streaming: boolean): string {
	const [display, setDisplay] = useState(text);
	const latestRef = useRef(text);
	const rafRef = useRef<number | null>(null);
	const displayRef = useRef(text);
	const lastTimeRef = useRef(0);

	useEffect(() => {
		latestRef.current = text;
		if (!streaming) {
			if (rafRef.current != null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			displayRef.current = text;
			setDisplay(text);
			return;
		}
		if (rafRef.current != null) return;
		lastTimeRef.current = performance.now();
		rafRef.current = requestAnimationFrame(function step(now: number) {
			const elapsed = now - lastTimeRef.current;
			lastTimeRef.current = now;
			const target = latestRef.current;
			const shown = displayRef.current;
			if (shown === target) {
				rafRef.current = null;
				return;
			}
			const lag = target.length - shown.length;
			if (lag >= TYPEWRITER_MAX_LAG) {
				displayRef.current = target;
			} else {
				const advance = Math.max(1, Math.round(elapsed * TYPEWRITER_CHARS_PER_MS));
				displayRef.current = target.slice(0, shown.length + advance);
			}
			setDisplay(displayRef.current);
			rafRef.current = requestAnimationFrame(step);
		});
		return () => {
			if (rafRef.current != null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
		};
	}, [text, streaming]);

	return streaming ? display : text;
}

/**
 * Stream Markdown with a frozen closed prefix (paragraph / closed fence) and a live tail.
 * When not streaming, renders the full message once (turn-end polish).
 */
export function StreamingMarkdownMessage({
	text,
	streaming,
	className
}: {
	text: string;
	streaming: boolean;
	className?: string;
}) {
	const throttled = useStreamingText(text, streaming);
	if (!streaming) {
		return <MarkdownMessage text={throttled} className={className} />;
	}
	const {frozen, pending} = splitStreamingMarkdown(throttled);
	return (
		<div className={cn('streaming-markdown', className)}>
			{frozen ? <FrozenMarkdownBlock text={frozen} /> : null}
			{pending ? (
				<MarkdownMessage text={pending} deferCodeHighlight streamingTail />
			) : null}
			{!frozen && !pending ? (
				<MarkdownMessage text={throttled} deferCodeHighlight streamingTail />
			) : null}
		</div>
	);
}
