import {shellT as t} from './i18n/t';
import {previewToolOutput} from './toolPresentation';
import {tintOutputLine} from './outputTint';

/** Tail-first three-line preview for a collapsed tool card. */
export function ToolOutputPreview({output}: {output: string}) {
	const {lines, hidden} = previewToolOutput(output);
	if (lines.length === 0) return null;
	return (
		<div className="font-mono text-[11px] leading-4 text-muted-foreground/80">
			{lines.map((line, i) => (
				<span key={i} className="block truncate" title={line.trim() || undefined}>
					{tintOutputLine(line.length === 0 ? ' ' : line)}
				</span>
			))}
			{hidden > 0 ? (
				<span className="mt-0.5 block text-[10px] text-muted-foreground/50">
					{t('shell.toolCard.moreLines', {count: hidden})}
				</span>
			) : null}
		</div>
	);
}
