import {useTranslation} from 'react-i18next';
import {useState} from 'react';
import {Button} from '@fast-ide/ui/components/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger
} from '@fast-ide/ui/components/collapsible';
import {Input} from '@fast-ide/ui/components/input';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	ArrowUp,
	Circle,
	ChevronDown,
	Pause,
	Play,
	Pencil,
	Trash2,
	Zap
} from 'lucide-react';
import type {QueueItem} from '../env';

export function QueuedMessagesSection({
	queue,
	queuePaused = false,
	onInterrupt,
	onInterruptError
}: {
	queue: QueueItem[];
	queuePaused?: boolean;
	onInterrupt?: (item: QueueItem) => void;
	onInterruptError?: (message: string) => void;
}) {
	const {t} = useTranslation();
	const [open, setOpen] = useState(true);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editDraft, setEditDraft] = useState('');
	/** Optimistic removal: interrupted rows vanish instantly (cursor-style) and
	 *  reappear only if the engine refuses or the call fails. */
	const [hidden, setHidden] = useState<Set<string>>(() => new Set());

	const visible = queue.filter(item => !hidden.has(item.id));

	if (visible.length === 0 && !queuePaused) return null;

	function startEdit(item: QueueItem) {
		setEditingId(item.id);
		setEditDraft(item.text);
	}

	function unhide(id: string) {
		setHidden(prev => {
			if (!prev.has(id)) return prev;
			const next = new Set(prev);
			next.delete(id);
			return next;
		});
	}

	function interrupt(item: QueueItem) {
		if (hidden.has(item.id)) return;
		setHidden(prev => new Set(prev).add(item.id));
		onInterrupt?.(item);
		window.fastIde
			.interruptQueueItem(item.id)
			.then(ok => {
				if (!ok) {
					unhide(item.id);
					onInterruptError?.('The engine refused the interrupt — the queued message was restored.');
				}
			})
			.catch((error: unknown) => {
				unhide(item.id);
				const detail = error instanceof Error ? error.message : String(error);
				onInterruptError?.(`Failed to interrupt — the queued message was restored. ${detail}`);
			});
	}

	async function commitEdit(itemId: string) {
		const text = editDraft.trim();
		setEditingId(null);
		if (!text) return;
		await window.fastIde.editQueueItem(itemId, text);
	}

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<div className="flex h-8 items-center gap-1 px-2">
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
					>
						<ChevronDown
							className={cn('size-3 shrink-0 transition-transform', !open && '-rotate-90')}
						/>
						<span className="truncate">
							{visible.length} Queued{queuePaused ? ' · Paused' : ''}
						</span>
					</button>
				</CollapsibleTrigger>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className="size-6 shrink-0 text-muted-foreground"
					aria-label={queuePaused ? 'Resume queue' : 'Pause queue'}
					title={queuePaused ? 'Resume drain' : 'Pause drain'}
					onClick={() => void window.fastIde.setQueuePaused(!queuePaused)}
				>
					{queuePaused ? <Play className="size-3" /> : <Pause className="size-3" />}
				</Button>
			</div>
			<CollapsibleContent>
				{visible.length === 0 ? (
					<p className="px-3 pb-2 text-xs text-muted-foreground">
						Queue paused — new Follow-ups still enqueue; drain is off.
					</p>
				) : (
					<ul className="space-y-0.5 px-2 pb-2">
						{visible.map((item, index) => {
							return (
								<li
									key={item.id}
									className="group/queue flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50"
								>
									<Circle
										className="size-3.5 shrink-0 text-muted-foreground/70"
										aria-hidden
									/>
									{editingId === item.id ? (
										<Input
											className="h-7 flex-1"
											value={editDraft}
											autoFocus
											onChange={e => setEditDraft(e.target.value)}
											onBlur={() => void commitEdit(item.id)}
											onKeyDown={e => {
												if (e.key === 'Enter') {
													e.preventDefault();
													void commitEdit(item.id);
												}
												if (e.key === 'Escape') setEditingId(null);
											}}
										/>
									) : (
										<span
											className="min-w-0 flex-1 truncate text-sm text-foreground"
											title={item.text}
										>
											{item.text}
										</span>
									)}
									<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/queue:opacity-100 focus-within:opacity-100">
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											className="size-6 text-muted-foreground"
											aria-label={t('shell.queue.interruptAria')}
											title={t('shell.queue.interruptTitle')}
											onClick={() => interrupt(item)}
										>
											<Zap className="size-3" />
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											className="size-6 text-muted-foreground"
											aria-label="Edit"
											title="Edit"
											onClick={() => startEdit(item)}
										>
											<Pencil className="size-3" />
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											className="size-6 text-muted-foreground"
											disabled={index === 0}
											aria-label="Move up"
											title="Move up"
											onClick={() => void window.fastIde.reorderQueue(index, index - 1)}
										>
											<ArrowUp className="size-3" />
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											className="size-6 text-muted-foreground"
											aria-label="Remove"
											title="Remove"
											onClick={() => void window.fastIde.removeQueueItem(item.id)}
										>
											<Trash2 className="size-3" />
										</Button>
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
