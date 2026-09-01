import {shellT as t} from '../i18n/t';
import {MarkdownMessage} from '../MarkdownMessage';
import type {DocumentPreviewKind} from './documentPreviewKind';

/**
 * Read-only rendering of a Document tab body.
 *
 * HTML runs in a unique-origin iframe (`allow-scripts` without `allow-same-origin`)
 * so a preview cannot reach the IDE. Relative assets in HTML may not load — that
 * is a later host-FS concern, not this pane.
 */
export function DocumentPreview({
	kind,
	body,
	title
}: {
	kind: DocumentPreviewKind;
	body: string;
	title: string;
}) {
	if (kind === 'markdown') {
		return (
			<div className="min-h-0 flex-1 overflow-auto px-4 py-3">
				{body.trim() ? (
					<MarkdownMessage text={body} />
				) : (
					<p className="text-sm text-muted-foreground">{t('shell.tabs.emptyDocument')}</p>
				)}
			</div>
		);
	}

	if (kind === 'svg') {
		const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(body)}`;
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/20 p-4">
				{body.trim() ? (
					<img src={src} alt={title} className="max-h-full max-w-full object-contain" />
				) : (
					<p className="text-sm text-muted-foreground">{t('shell.tabs.emptyDocument')}</p>
				)}
			</div>
		);
	}

	return (
		<iframe
			title={title}
			sandbox="allow-scripts allow-forms"
			srcDoc={body}
			className="min-h-0 min-w-0 flex-1 border-0 bg-white"
		/>
	);
}
