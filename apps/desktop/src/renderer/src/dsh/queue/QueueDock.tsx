import {useEffect, useMemo, useRef, useState} from 'react';
import {Button} from '@fast-ide/ui/components/button';
import {Input} from '@fast-ide/ui/components/input';
import {Pencil, Trash2, Zap} from 'lucide-react';
import type {DshQueueItem} from '../../env';
import {dockOpen, inboxItems, steeringItems} from './visible';

const DISMISS_TTL_MS = 8000;

export function QueueDock({
	capsQueue,
	items
}: {
	capsQueue?: boolean;
	items: DshQueueItem[];
}) {
	const [dismissedAt, setDismissedAt] = useState<Map<string, number>>(new Map());
	const dismiss = (id: string) =>
		setDismissedAt(prev => {
			if (prev.has(id)) return prev;
			const next = new Map(prev);
			next.set(id, Date.now());
			return next;
		});

	const liveItems = useMemo(
		() =>
			items.filter(i => {
				const at = dismissedAt.get(i.id);
				if (at === undefined) return true;
				if (i.placement !== 'queued') return true;
				return Date.now() - at > DISMISS_TTL_MS;
			}),
		[items, dismissedAt]
	);

	const latest = useRef(items);
	latest.current = items;
	useEffect(() => {
		const t = window.setInterval(() => {
			setDismissedAt(prev => {
				if (prev.size === 0) return prev;
				const now = Date.now();
				const next = new Map<string, number>();
				for (const [id, at] of prev) {
					const stillQueued = latest.current.some(i => i.id === id && i.placement === 'queued');
					if (stillQueued && now - at < DISMISS_TTL_MS) next.set(id, at);
				}
				return next.size === prev.size ? prev : next;
			});
		}, 1000);
		return () => window.clearInterval(t);
	}, []);

	const inbox = inboxItems(liveItems);
	const steering = steeringItems(liveItems);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draft, setDraft] = useState('');
	if (!dockOpen(capsQueue, liveItems)) return null;

	return (
		<div className="px-2 py-1.5 text-xs">
			{inbox.length > 0 ? (
				<ul className="space-y-1">
					{inbox.map(item => (
						<li key={item.id} className="flex items-center gap-1">
							{editingId === item.id ? (
								<Input
									value={draft}
									onChange={e => setDraft(e.target.value)}
									onBlur={() => {
										const text = draft.trim();
										setEditingId(null);
										if (text) void window.fastIde.editQueueItem(item.id, text);
									}}
									onKeyDown={e => {
										if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
									}}
									className="h-7 text-xs"
								/>
							) : (
								<span className="min-w-0 flex-1 truncate text-muted-foreground">{item.text}</span>
							)}
							<Button
								type="button"
								size="icon"
								variant="ghost"
								className="size-6"
								onClick={() => {
									setEditingId(item.id);
									setDraft(item.text);
								}}
							>
								<Pencil className="size-3" />
							</Button>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								className="size-6"
								onClick={() => {
									dismiss(item.id);
									void window.fastIde.interruptQueueItem(item.id);
								}}
							>
								<Zap className="size-3" />
							</Button>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								className="size-6"
								onClick={() => {
									dismiss(item.id);
									void window.fastIde.removeQueueItem(item.id);
								}}
							>
								<Trash2 className="size-3" />
							</Button>
						</li>
					))}
				</ul>
			) : null}
			{steering.length > 0 ? (
				<div className="mt-1 flex flex-wrap gap-1">
					{steering.map(item => (
						<span
							key={item.id}
							className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
						>
							{item.text}
						</span>
					))}
				</div>
			) : null}
		</div>
	);
}
