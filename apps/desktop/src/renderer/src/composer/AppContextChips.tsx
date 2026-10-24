import {cn} from '@fast-ide/ui/lib/utils';
import {Boxes, X} from 'lucide-react';
import type {AppContextEntry} from './appContext';

/** Pending `ui/update-model-context` payloads; consumed by the next send. */
export function AppContextChips({
	entries,
	onRemove
}: {
	entries: AppContextEntry[];
	onRemove: (id: string) => void;
}) {
	if (entries.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-1.5 border-b border-border/40 px-4 py-2">
			{entries.map(entry => {
				const extra = entry.images.length + entry.links.length;
				return (
					<span
						key={entry.id}
						className={cn(
							'inline-flex max-w-[16rem] items-center gap-1.5 rounded-md px-2 py-1 text-[11px]',
							'bg-[#007AFF]/10 text-[#007AFF] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]'
						)}
						title={[entry.title, ...entry.text].join('\n')}
					>
						<Boxes className="size-3 shrink-0" />
						<span className="truncate font-medium">{entry.title}</span>
						{extra > 0 ? <span className="tabular-nums opacity-70">+{extra}</span> : null}
						<button
							type="button"
							className="rounded-sm p-0.5 opacity-70 hover:opacity-100"
							aria-label={entry.title}
							onClick={() => onRemove(entry.id)}
						>
							<X className="size-3" />
						</button>
					</span>
				);
			})}
		</div>
	);
}
