import {useEffect, useRef} from 'react';
import {useTranslation} from 'react-i18next';
import {Range, editor as monacoEditor} from 'monaco-editor';
import type {FileReviewDiff} from '@fast-ide/session-view';
import {overlayAnchorsMatch} from './agentReview';
import './reviewOverlay.css';

/**
 * Paint the pending agent effect onto the document editor: green tints on added lines, red view
 * zones for deleted lines, one glyph per hunk. Hunks come from the batched snapshot
 * (review-diff-batch-hunks §五). Dirty buffers hide the overlay rather than letting line numbers
 * drift; a flush (`setValue` / reload) or a clean `dirty` flag restores it.
 *
 * Drift is judged by whether hunk `newLine`s still match the buffer (EOL / trailing newline
 * differences are not drift). A whole-file blob comparison is too strict and hid every mark.
 *
 * Keystrokes only flip `localDirty` and swap to a paused glyph (review-diff-batch-hunks §5.1 /
 * §5.3) — they must not walk hunks. A flush or a cleared `dirty` flag is what repaints.
 */
export function useReviewOverlay(
	getEditor: () => monacoEditor.IStandaloneCodeEditor | null,
	path: string | null | undefined,
	diff: FileReviewDiff | null | undefined,
	/** Bump when the editor model is replaced or disk content is reloaded. */
	modelEpoch: string | number | undefined,
	/** Tab dirty flag from React — pairs with the local content-change listener. */
	dirty?: boolean
) {
	const idsRef = useRef<string[]>([]);
	const zonesRef = useRef<string[]>([]);
	const localDirty = useRef(false);
	const {t} = useTranslation();

	useEffect(() => {
		localDirty.current = Boolean(dirty);
	}, [dirty]);

	useEffect(() => {
		const editor = getEditor();
		if (!editor) return;

		const clearDecorations = () => {
			if (idsRef.current.length === 0) return;
			editor.deltaDecorations(idsRef.current, []);
			idsRef.current = [];
		};
		const clearZones = () => {
			if (zonesRef.current.length === 0) return;
			editor.changeViewZones(accessor => {
				for (const id of zonesRef.current) accessor.removeZone(id);
			});
			zonesRef.current = [];
		};
		const clear = () => {
			clearDecorations();
			clearZones();
		};

		const paintPaused = (message: string) => {
			clearZones();
			idsRef.current = editor.deltaDecorations(idsRef.current, [
				{
					range: new Range(1, 1, 1, 1),
					options: {
						linesDecorationsClassName: 'review-glyph-paused',
						hoverMessage: {value: message},
						stickiness: monacoEditor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
					}
				}
			]);
		};

		const paintHunks = (model: monacoEditor.ITextModel) => {
			if (!diff) return;
			const maxLine = model.getLineCount();
			const addLines: number[] = [];
			const delZones: {after: number; lines: string[]}[] = [];
			for (const hunk of diff.hunks) {
				let lastAfter = 0;
				let pendingDel: string[] = [];
				const flushDel = () => {
					if (pendingDel.length === 0) return;
					const after = lastAfter === 0 ? 0 : Math.min(lastAfter, maxLine);
					delZones.push({after, lines: pendingDel});
					pendingDel = [];
				};
				for (const entry of hunk.lines) {
					if (entry.kind === 'del') {
						pendingDel.push(entry.text);
					} else {
						flushDel();
						lastAfter = entry.newLine ?? lastAfter;
						if (entry.kind === 'add' && lastAfter > 0 && lastAfter <= maxLine) {
							addLines.push(lastAfter);
						}
					}
				}
				flushDel();
			}

			const decorations = addLines.map(line => ({
				range: new Range(line, 1, line, 1),
				options: {
					isWholeLine: true,
					linesDecorationsClassName: 'review-glyph-add',
					className: 'review-line-add',
					stickiness: monacoEditor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
				}
			}));
			idsRef.current = editor.deltaDecorations(idsRef.current, decorations);

			editor.changeViewZones(accessor => {
				for (const id of zonesRef.current) accessor.removeZone(id);
				zonesRef.current = delZones.map(zone =>
					accessor.addZone({
						afterLineNumber: zone.after,
						heightInLines: Math.max(zone.lines.length, 1),
						domNode: delZoneNode(zone.lines),
						suppressMouseDown: true
					})
				);
			});
		};

		let painted = false;
		const paint = () => {
			const model = editor.getModel();
			if (!model) {
				painted = false;
				clear();
				return;
			}
			if (localDirty.current) {
				painted = false;
				paintPaused(t('shell.reviewStatus.hoverPaused'));
				return;
			}
			if (!diff || diff.broken || diff.blocked) {
				painted = false;
				clear();
				return;
			}
			const lineAt = (n: number) =>
				n >= 1 && n <= model.getLineCount() ? model.getLineContent(n) : undefined;
			if (!overlayAnchorsMatch(diff.hunks, lineAt)) {
				painted = false;
				paintPaused(t('shell.reviewStatus.hoverDrift'));
				return;
			}
			if (painted) return;
			paintHunks(model);
			painted = true;
		};

		paint();
		const contentSub = editor.onDidChangeModelContent(e => {
			if (e.isFlush) {
				localDirty.current = false;
				painted = false;
				paint();
				return;
			}
			if (localDirty.current) return;
			localDirty.current = true;
			painted = false;
			paintPaused(t('shell.reviewStatus.hoverPaused'));
		});
		const modelSub = editor.onDidChangeModel(() => {
			painted = false;
			paint();
		});
		return () => {
			contentSub.dispose();
			modelSub.dispose();
			clear();
		};
	}, [getEditor, path, diff, modelEpoch, dirty, t]);

	useEffect(
		() => () => {
			const editor = getEditor();
			if (!editor) {
				idsRef.current = [];
				zonesRef.current = [];
				return;
			}
			try {
				if (idsRef.current.length > 0) editor.deltaDecorations(idsRef.current, []);
				if (zonesRef.current.length > 0) {
					editor.changeViewZones(accessor => {
						for (const id of zonesRef.current) accessor.removeZone(id);
					});
				}
			} catch {
				// Editor already torn down — nothing to clear.
			}
			idsRef.current = [];
			zonesRef.current = [];
		},
		[getEditor]
	);
}

function delZoneNode(lines: string[]): HTMLElement {
	const root = document.createElement('div');
	root.className = 'review-del-zone';
	for (const text of lines) {
		const row = document.createElement('div');
		row.className = 'review-del-zone-line';
		row.textContent = text.length > 0 ? text : ' ';
		root.appendChild(row);
	}
	return root;
}
