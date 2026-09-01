import {useMemo} from 'react';
import {DiffEditor} from '@monaco-editor/react';
import {cn} from '@fast-ide/ui/lib/utils';
// Also pulls in the `loader.config({monaco})` that binds the bundled monaco, so the diff editor and
// the code editor share one instance instead of the wrapper fetching a second copy from the CDN.
import {languageFromPath, useIsDark} from './MonacoEditor';

/**
 * A read-only diff of two recorded states of one file.
 *
 * Read-only on purpose: both sides are checkpoint content, and the file on disk is not either of them
 * in the general case. Editing here would write into a state the user is only looking at.
 */
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

	return (
		<div className={cn('min-h-0 min-w-0 flex-1 overflow-hidden', className)}>
			<DiffEditor
				height="100%"
				language={language}
				theme={dark ? 'vs-dark' : 'vs'}
				original={original}
				modified={modified}
				options={{
					readOnly: true,
					// The rail is too narrow for two columns; inline keeps the code readable at rail width.
					renderSideBySide: false,
					automaticLayout: true,
					fontSize: 13,
					fontFamily:
						'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
					lineHeight: 20,
					minimap: {enabled: false},
					scrollBeyondLastLine: false,
					wordWrap: 'on',
					scrollbar: {verticalScrollbarSize: 8, horizontalScrollbarSize: 8},
					padding: {top: 8, bottom: 8},
					overviewRulerLanes: 0,
					hideCursorInOverviewRuler: true,
					overviewRulerBorder: false
				}}
				loading={
					<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
						Loading diff…
					</div>
				}
			/>
		</div>
	);
}
