import {forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react';
import Editor, {loader, type OnMount} from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import type {FileReviewDiff} from '@fast-ide/session-view';
import {cn} from '@fast-ide/ui/lib/utils';
import {languageLabel} from './languageLabel';
import {useReviewOverlay} from './review/useReviewOverlay';

loader.config({monaco});

export type EditorCursorStatus = {
	line: number;
	column: number;
	language: string;
	languageLabel: string;
	indentLabel: string;
	encoding: string;
	eol: string;
};

export type MonacoEditorHandle = {
	getValue: () => string;
	setValue: (next: string) => void;
	revealPosition?: (line: number, column?: number, endLine?: number) => void;
};

const EXT_LANG: Record<string, string> = {
	ts: 'typescript',
	tsx: 'typescript',
	mts: 'typescript',
	cts: 'typescript',
	js: 'javascript',
	jsx: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	json: 'json',
	md: 'markdown',
	markdown: 'markdown',
	css: 'css',
	scss: 'scss',
	less: 'less',
	html: 'html',
	htm: 'html',
	xml: 'xml',
	svg: 'xml',
	yml: 'yaml',
	yaml: 'yaml',
	toml: 'ini',
	ini: 'ini',
	py: 'python',
	rb: 'ruby',
	go: 'go',
	rs: 'rust',
	java: 'java',
	kt: 'kotlin',
	kts: 'kotlin',
	swift: 'swift',
	c: 'c',
	h: 'c',
	cpp: 'cpp',
	cc: 'cpp',
	cxx: 'cpp',
	hpp: 'cpp',
	cs: 'csharp',
	php: 'php',
	sql: 'sql',
	sh: 'shell',
	bash: 'shell',
	zsh: 'shell',
	fish: 'shell',
	ps1: 'powershell',
	dockerfile: 'dockerfile',
	scala: 'scala',
	sc: 'scala',
	sbt: 'scala',
	r: 'r',
	lua: 'lua',
	dart: 'dart',
	vue: 'html',
	svelte: 'html',
	graphql: 'graphql',
	gql: 'graphql',
	txt: 'plaintext',
	log: 'plaintext'
};

export function languageFromPath(filePath?: string | null): string {
	if (!filePath) return 'plaintext';
	const base = filePath.split(/[/\\]/).pop() ?? filePath;
	if (/^dockerfile$/i.test(base) || /^containerfile$/i.test(base)) return 'dockerfile';
	const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : '';
	return EXT_LANG[ext] ?? 'plaintext';
}

/** Monaco may rewrite CRLF to LF on load — that is not a user edit. */
function sameEditorText(a: string, b: string): boolean {
	return a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
}

export function useIsDark(): boolean {
	const [dark, setDark] = useState(() =>
		typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
	);
	useEffect(() => {
		const root = document.documentElement;
		const sync = () => setDark(root.classList.contains('dark'));
		sync();
		const observer = new MutationObserver(sync);
		observer.observe(root, {attributes: true, attributeFilter: ['class']});
		return () => observer.disconnect();
	}, []);
	return dark;
}

export const MonacoEditor = forwardRef<
	MonacoEditorHandle,
	{
		/** Initial model text. Remount via `path`/`seedKey` to replace. */
		defaultValue?: string;
		/** Controlled fallback (read-only Diff etc.). Prefer defaultValue for Documents. */
		value?: string;
		onChange?: (value: string) => void;
		/** Fired when the buffer diverges from the seed (uncontrolled Documents). */
		onDirty?: () => void;
		/** Prefer over forwardRef when the editor is behind `React.lazy`. */
		onReady?: (handle: MonacoEditorHandle | null) => void;
		path?: string | null;
		/** Extra remount key when path is stable but disk content was reloaded. */
		seedKey?: string | number;
		readOnly?: boolean;
		className?: string;
		onCursorStatus?: (status: EditorCursorStatus | null) => void;
		/** Pending agent effect for this file — painted as gutter glyphs + line tints. */
		reviewDiff?: FileReviewDiff | null;
		/** Hide overlay decorations while the buffer diverges from disk (review-diff-batch-hunks §5.1). */
		reviewDirty?: boolean;
		/** Bump when disk content is reloaded in place so decorations re-apply without remounting. */
		reviewReloadEpoch?: string | number;
		/** Hidden tabs keep the editor mounted (`display:none`); bump so view zones relayout when shown. */
		reviewVisible?: boolean;
	}
>(function MonacoEditor(
	{
		defaultValue,
		value,
		onChange,
		onDirty,
		onReady,
		path,
		seedKey,
		readOnly = false,
		className,
		onCursorStatus,
		reviewDiff,
		reviewDirty,
		reviewReloadEpoch,
		reviewVisible
	},
	ref
) {
	const dark = useIsDark();
	const language = useMemo(() => languageFromPath(path), [path]);
	const onCursorStatusRef = useRef(onCursorStatus);
	onCursorStatusRef.current = onCursorStatus;
	const onDirtyRef = useRef(onDirty);
	onDirtyRef.current = onDirty;
	const languageRef = useRef(language);
	languageRef.current = language;
	const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const seed = defaultValue ?? value ?? '';
	const seedRef = useRef(seed);
	seedRef.current = seed;
	const uncontrolled = defaultValue !== undefined && value === undefined;

	const getEditor = useCallback(() => editorRef.current, []);
	const [mountEpoch, setMountEpoch] = useState(0);
	useReviewOverlay(
		getEditor,
		path,
		reviewDiff,
		[mountEpoch, seedKey ?? '', reviewReloadEpoch ?? '', reviewVisible === false ? 'h' : 'v'].join(':'),
		reviewDirty
	);

	const handleApi = (): MonacoEditorHandle => ({
		getValue: () => editorRef.current?.getValue() ?? seed,
		setValue: (next: string) => {
			const editor = editorRef.current;
			if (!editor) return;
			const model = editor.getModel();
			if (!model) return;
			if (model.getValue() === next) return;
			const pos = editor.getPosition();
			const scrollTop = editor.getScrollTop();
			model.setValue(next);
			if (pos) {
				const line = Math.min(pos.lineNumber, model.getLineCount());
				const column = Math.min(pos.column, model.getLineMaxColumn(line));
				editor.setPosition({lineNumber: line, column});
				editor.setScrollTop(scrollTop);
			}
		},
		revealPosition: (line: number, column = 1, endLine?: number) => {
			const editor = editorRef.current;
			if (!editor) return;
			const model = editor.getModel();
			if (!model) return;
			const validLine = Math.min(Math.max(1, line), model.getLineCount());
			const validCol = Math.min(Math.max(1, column), model.getLineMaxColumn(validLine));
			editor.revealLineInCenter(validLine);
			editor.setPosition({lineNumber: validLine, column: validCol});
			if (endLine && endLine >= validLine) {
				const validEnd = Math.min(endLine, model.getLineCount());
				editor.setSelection({
					startLineNumber: validLine,
					startColumn: validCol,
					endLineNumber: validEnd,
					endColumn: model.getLineMaxColumn(validEnd)
				});
			}
			editor.focus();
		}
	});

	useImperativeHandle(ref, handleApi, [seed]);

	useEffect(() => {
		onReady?.(handleApi());
		return () => onReady?.(null);
	}, [seed, seedKey, path]); // eslint-disable-line react-hooks/exhaustive-deps -- rebind when model remounts

	const publish = () => {
		const cb = onCursorStatusRef.current;
		const editor = editorRef.current;
		if (!cb || !editor) return;
		const pos = editor.getPosition();
		const model = editor.getModel();
		const lang = languageRef.current;
		const eol = model?.getEOL() === '\r\n' ? 'CRLF' : 'LF';
		const tabSize = model?.getOptions().tabSize ?? 2;
		const insertSpaces = model?.getOptions().insertSpaces ?? true;
		cb({
			line: pos?.lineNumber ?? 1,
			column: pos?.column ?? 1,
			language: lang,
			languageLabel: languageLabel(lang),
			indentLabel: insertSpaces ? `Spaces: ${tabSize}` : `Tab Size: ${tabSize}`,
			encoding: 'UTF-8',
			eol
		});
	};

	useEffect(() => {
		publish();
	}, [language]); // eslint-disable-line react-hooks/exhaustive-deps -- republish label when path language changes

	useEffect(() => {
		return () => onCursorStatusRef.current?.(null);
	}, []);

	const handleMount: OnMount = editor => {
		editorRef.current = editor;
		setMountEpoch(e => e + 1);
		onReady?.(handleApi());
		publish();
		const disposables = [
			editor.onDidChangeCursorPosition(() => publish()),
			editor.onDidChangeModelOptions(() => publish()),
			editor.onDidChangeModel(() => publish())
		];
		editor.onDidDispose(() => {
			for (const d of disposables) d.dispose();
			editorRef.current = null;
			onReady?.(null);
			onCursorStatusRef.current?.(null);
		});
	};

	const modelPath =
		path != null
			? seedKey != null
				? `${path}#${seedKey}`
				: path
			: seedKey != null
				? `untitled#${seedKey}`
				: undefined;

	return (
		<div className={cn('min-h-0 min-w-0 flex-1 overflow-hidden', className)}>
			<Editor
				height="100%"
				language={language}
				path={modelPath}
				theme={dark ? 'vs-dark' : 'vs'}
				defaultValue={uncontrolled ? seed : undefined}
				value={uncontrolled ? undefined : value}
				onChange={next => {
					const text = next ?? '';
					if (uncontrolled && !sameEditorText(text, seedRef.current)) onDirtyRef.current?.();
					onChange?.(text);
				}}
				onMount={handleMount}
				options={{
					readOnly,
					automaticLayout: true,
					fontSize: 13,
					fontFamily:
						'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
					lineHeight: 20,
					minimap: {enabled: false},
					scrollBeyondLastLine: false,
					wordWrap: 'on',
					tabSize: 2,
					lineDecorationsWidth: 12,
					renderLineHighlight: 'line',
					scrollbar: {
						verticalScrollbarSize: 8,
						horizontalScrollbarSize: 8
					},
					padding: {top: 8, bottom: 8},
					overviewRulerLanes: 0,
					hideCursorInOverviewRuler: true,
					overviewRulerBorder: false,
					smoothScrolling: true
				}}
				loading={
					<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
						Loading editor…
					</div>
				}
			/>
		</div>
	);
});
