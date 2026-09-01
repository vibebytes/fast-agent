import {lazy, Suspense, useEffect, useRef, useState} from 'react';
import type {FileReviewDiff} from '@fast-ide/session-view';
import {Input} from '@fast-ide/ui/components/input';
import {cn} from '@fast-ide/ui/lib/utils';
import {FileText} from 'lucide-react';
import {shellT as t} from '../i18n/t';
import type {EditorCursorStatus, MonacoEditorHandle} from '../MonacoEditor';
import type {RailTab} from '../railTabs';
import type {AgentReview} from '../review/useAgentReview';
import {blockedNotice, overlayAnchorsMatch, overlayLineAt} from '../review/agentReview';
import {DocumentPreview} from './DocumentPreview';
import {documentPreviewKind} from './documentPreviewKind';

// Monaco is multi-MB — load on first Document tab, not at boot (perf doc P1-9).
const MonacoEditor = lazy(() =>
	import('../MonacoEditor').then(m => ({default: m.MonacoEditor}))
);

type DocumentView = 'source' | 'preview';

export function DocumentPane({
	tab,
	onPatch,
	onEditorStatus,
	onSave,
	active,
	bufferRef,
	review
}: {
	tab: RailTab;
	onPatch: (patch: Partial<RailTab>) => void;
	onEditorStatus?: (status: EditorCursorStatus | null) => void;
	/** ⌘S / Ctrl+S when this Document is focused. */
	onSave?: (content: string) => void | Promise<void>;
	active?: boolean;
	/** Parent registers the Monaco handle for save / conflict / close. */
	bufferRef?: (handle: MonacoEditorHandle | null) => void;
	/** When set, pending agent hunks for this file are painted onto the editor. */
	review?: AgentReview | null;
}) {
	const fromDisk = Boolean(tab.filePath);
	const path = tab.filePath ?? tab.title;
	const previewKind = documentPreviewKind(path);
	const [view, setView] = useState<DocumentView>('source');
	const showingPreview = previewKind !== null && view === 'preview';
	const editorRef = useRef<MonacoEditorHandle | null>(null);
	const [previewBody, setPreviewBody] = useState(() => tab.baseContent ?? tab.body ?? '');
	const seed = tab.baseContent ?? tab.body ?? '';
	const batched = fromDisk && !showingPreview ? review?.diffFor(path) : undefined;
	const [override, setOverride] = useState<FileReviewDiff | null>(null);

	const fileDiffOf = review?.fileDiff;
	useEffect(() => {
		if (!fileDiffOf || batched?.blocked !== 'too-many-changes') {
			setOverride(null);
			return;
		}
		let live = true;
		void fileDiffOf(path).then(file => {
			if (live) setOverride(file);
		});
		return () => {
			live = false;
		};
	}, [fileDiffOf, batched?.blocked, path, review?.diff?.revision]);

	const overlayDiff = override ?? batched ?? null;
	const overlayPaused = Boolean(tab.dirty && overlayDiff && !overlayDiff.broken && !overlayDiff.blocked);
	const overlayDrift = Boolean(
		overlayDiff &&
			!overlayDiff.broken &&
			!overlayDiff.blocked &&
			overlayDiff.hunks.length > 0 &&
			!tab.dirty &&
			!overlayAnchorsMatch(overlayDiff.hunks, overlayLineAt(seed))
	);

	useEffect(() => {
		bufferRef?.(editorRef.current);
		return () => bufferRef?.(null);
	}, [bufferRef, tab.id, tab.editorEpoch]);

	useEffect(() => {
		if (tab.targetPosition && editorRef.current) {
			editorRef.current.revealPosition?.(
				tab.targetPosition.line,
				1,
				tab.targetPosition.endLine
			);
		}
	}, [tab.targetPosition?.nonce, tab.targetPosition?.line, tab.targetPosition?.endLine]);

	useEffect(() => {
		if (!previewKind && view !== 'source') setView('source');
	}, [previewKind, view]);

	useEffect(() => {
		if (showingPreview) onEditorStatus?.(null);
	}, [showingPreview, onEditorStatus]);

	useEffect(() => {
		if (view === 'preview') {
			setPreviewBody(editorRef.current?.getValue() ?? tab.baseContent ?? tab.body ?? '');
		}
	}, [view, tab.baseContent, tab.body, tab.editorEpoch]);

	useEffect(() => {
		if (!active || !onSave || !fromDisk) return;
		const onKey = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return;
			e.preventDefault();
			const content = editorRef.current?.getValue() ?? '';
			void onSave(content);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [active, onSave, fromDisk]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-col gap-0.5 border-b px-2 py-1.5">
				<div className="flex items-center gap-2">
					<FileText className="size-3.5 shrink-0 text-muted-foreground" />
					{fromDisk ? (
						<span className="min-w-0 flex-1 truncate text-sm font-medium">
							{tab.title}
							{tab.dirty ? ' •' : ''}
						</span>
					) : (
						<Input
							value={tab.title}
							onChange={e => onPatch({title: e.target.value || 'Untitled'})}
							className="h-7 min-w-0 flex-1 border-0 bg-transparent text-sm font-medium shadow-none focus-visible:ring-0"
						/>
					)}
					{previewKind ? (
						<div
							role="group"
							aria-label={t('shell.tabs.documentView')}
							className="ml-auto flex shrink-0 rounded-full bg-muted p-0.5"
						>
							{(
								[
									['source', t('shell.tabs.source')],
									['preview', t('shell.tabs.preview')]
								] as const
							).map(([id, label]) => (
								<button
									key={id}
									type="button"
									aria-pressed={view === id}
									onClick={() => setView(id)}
									className={cn(
										'rounded-full px-2 py-0.5 text-[11px] leading-4 transition-colors',
										view === id
											? 'bg-background font-medium text-foreground'
											: 'text-muted-foreground hover:text-foreground'
									)}
								>
									{label}
								</button>
							))}
						</div>
					) : null}
				</div>
				{tab.filePath ? (
					<p className="truncate pl-5 font-mono text-[11px] text-muted-foreground" title={tab.filePath}>
						{tab.filePath}
					</p>
				) : null}
				{overlayPaused ? (
					<p className="truncate pl-5 text-[11px] text-amber-600 dark:text-amber-400">
						{t('shell.reviewStatus.paused')}
					</p>
				) : overlayDrift ? (
					<p className="truncate pl-5 text-[11px] text-amber-600 dark:text-amber-400">
						{t('shell.reviewStatus.drift')}
					</p>
				) : overlayDiff?.blocked ? (
					<p className="truncate pl-5 text-[11px] text-muted-foreground">
						{blockedNotice(overlayDiff.blocked, 'overlay')}
					</p>
				) : overlayDiff?.broken ? (
					<p className="truncate pl-5 text-[11px] text-amber-600 dark:text-amber-400">
						{t('shell.reviewStatus.broken')}
					</p>
				) : null}
			</div>
			<Suspense
				fallback={
					showingPreview ? null : (
						<pre className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[12px] leading-5 whitespace-pre-wrap text-muted-foreground">
							{seed}
						</pre>
					)
				}
			>
				<div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', showingPreview && 'hidden')}>
					<MonacoEditor
						defaultValue={seed}
						seedKey={tab.editorEpoch ?? 0}
						path={path}
						reviewDiff={overlayDiff}
						reviewDirty={tab.dirty}
						reviewReloadEpoch={tab.savedMtimeMs ?? 0}
						reviewVisible={active !== false}
						onReady={handle => {
							editorRef.current = handle;
							bufferRef?.(handle);
							if (handle && tab.targetPosition) {
								handle.revealPosition?.(
									tab.targetPosition.line,
									1,
									tab.targetPosition.endLine
								);
							}
						}}
						onDirty={() => {
							if (!tab.dirty) onPatch({dirty: true});
						}}
						onCursorStatus={showingPreview ? undefined : onEditorStatus}
					/>
				</div>
			</Suspense>
			{showingPreview && previewKind ? (
				<DocumentPreview kind={previewKind} body={previewBody} title={tab.title} />
			) : null}
		</div>
	);
}
