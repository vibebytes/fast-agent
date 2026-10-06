import {type TimelineItem} from '@fast-ide/session-view';
import {Card, CardContent, CardHeader, CardTitle} from '@fast-ide/ui/components/card';
import {cn} from '@fast-ide/ui/lib/utils';
import {ChevronDown, ChevronRight} from 'lucide-react';
import {useState, type ReactNode} from 'react';

export function ForeignFromCard({
	item,
	children
}: {
	item: Extract<TimelineItem, {kind: 'foreignFold'}>;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const Icon = open ? ChevronDown : ChevronRight;
	return (
		<Card className="border-border/60 bg-card/80">
			<CardHeader className="flex flex-row items-center gap-2 space-y-0 py-3">
				<button
					type="button"
					className="inline-flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
					onClick={() => setOpen(v => !v)}
				>
					<Icon className="size-4 shrink-0 text-muted-foreground" />
					<CardTitle className="truncate text-sm font-medium">{item.displayName}</CardTitle>
				</button>
			</CardHeader>
			<CardContent className="pb-3 pt-0">
				{open ? (
					<div className="flex flex-col gap-2">{children}</div>
				) : item.preview ? (
					<pre
						className={cn(
							'max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground'
						)}
					>
						{item.preview}
					</pre>
				) : null}
			</CardContent>
		</Card>
	);
}
