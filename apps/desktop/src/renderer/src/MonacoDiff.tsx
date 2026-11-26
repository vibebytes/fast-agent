import {useEffect, useMemo, useRef} from 'react';
import * as monaco from 'monaco-editor';
import {cn} from '@fast-ide/ui/lib/utils';
import {languageFromPath, useIsDark} from './MonacoEditor';
import {revealFirstDiffWhenReady} from './diffReveal';
import {createDiffModels} from './diffModels';

export function MonacoDiff({
	original,
	modified,
	path,
	className
}: {
	original: string;
	modified: string;
	path?: string | null;
	className?: string;
}) {
	const dark = useIsDark();
	const language = useMemo(() => languageFromPath(path), [path]);
	const hostRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const editor = monaco.editor.createDiffEditor(host, {
			readOnly: true,
			renderSideBySide: false,
			automaticLayout: true,
			fontSize: 13,
			fontFamily:
				'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
			lineHeight: 20,
			minimap: {enabled: false},
			scrollBeyondLastLine: false,
			maxComputationTime: 1000,
			wordWrap: original.length + modified.length > 200_000 ? 'off' : 'on',
			scrollbar: {verticalScrollbarSize: 8, horizontalScrollbarSize: 8},
			padding: {top: 8, bottom: 8},
			overviewRulerLanes: 0,
			hideCursorInOverviewRuler: true,
			overviewRulerBorder: false
		});
		const models = createDiffModels(
			(value, lang) => monaco.editor.createModel(value, lang),
			original,
			modified,
			language
		);
		editor.setModel(models);
		editorRef.current = editor;
		revealFirstDiffWhenReady(editor);
		return () => {
			editor.dispose();
			models.original.dispose();
			models.modified.dispose();
			editorRef.current = null;
		};
	}, []);

	useEffect(() => {
		const editor = editorRef.current;
		const models = editor?.getModel();
		if (!editor || !models) return;
		if (models.original.getValue() !== original) models.original.setValue(original);
		if (models.modified.getValue() !== modified) models.modified.setValue(modified);
		monaco.editor.setModelLanguage(models.original, language);
		monaco.editor.setModelLanguage(models.modified, language);
		monaco.editor.setTheme(dark ? 'vs-dark' : 'vs');
		editor.updateOptions({wordWrap: original.length + modified.length > 200_000 ? 'off' : 'on'});
	}, [original, modified, language, dark]);

	return <div ref={hostRef} className={cn('min-h-0 min-w-0 flex-1 overflow-hidden', className)} />;
}
