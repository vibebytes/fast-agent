import {useTranslation} from 'react-i18next';
import {useState} from 'react';
import {planTodoProgress, type PlanTodoStatus, type PlanView} from '@fast-ide/session-view';
import {cn} from '@fast-ide/ui/lib/utils';
import {Check, ChevronDown, ChevronRight, Circle, ListTree, Square} from 'lucide-react';

function TodoIcon({status}: {status: PlanTodoStatus}) {
	if (status === 'completed') {
		return <Check className="size-3.5 shrink-0 text-muted-foreground" aria-label="completed" />;
	}
	if (status === 'in_progress') {
		return (
			<span
				className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-foreground"
				aria-label="in progress"
			>
				<ChevronRight className="size-2.5 text-background" />
			</span>
		);
	}
	return <Circle className="size-3.5 shrink-0 text-muted-foreground/45" aria-label="pending" />;
}

export type BuildDockProps = {
	planId: string;
	name: string;
	plan: PlanView | null;
	/** Show Stop on the collapsed/expanded header (active execute turn). */
	canStop: boolean;
	onStop?: () => void;
	className?: string;
};

/** Collapsed-by-default Plan execution dock (adheres under PlanBuild user). */
export function BuildDock({planId, name, plan, canStop, onStop, className}: BuildDockProps) {
	const {t} = useTranslation();
	const [open, setOpen] = useState(false);
	const todos = plan?.todos ?? [];
	const {completed, total, current} = planTodoProgress(todos);
	const title = (plan?.name || name).trim() || planId.slice(0, 8);
	const currentLabel = current?.content?.trim() || (total === 0 ? t('shell.buildDock.preparing') : t('shell.buildDock.waitingNext'));

	return (
		<div
			className={cn(
				'overflow-hidden rounded-b-2xl border border-t-0 border-border/50',
				'bg-muted/40 text-[13px] leading-snug text-foreground shadow-sm',
				className
			)}
		>
			<button
				type="button"
				className={cn(
					'flex w-full items-center gap-2 px-3 py-2 text-left',
					'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
				)}
				onClick={() => setOpen(v => !v)}
				aria-expanded={open}
			>
				<ChevronDown
					className={cn(
						'size-3.5 shrink-0 text-muted-foreground transition-transform',
						!open && '-rotate-90'
					)}
				/>
				<span className="shrink-0 text-muted-foreground">Build</span>
				<ListTree className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate font-medium">{title}</span>
				{canStop ? (
					<span
						role="button"
						tabIndex={0}
						aria-label="Stop"
						title="Stop (Esc)"
						className={cn(
							'inline-flex size-6 shrink-0 items-center justify-center rounded-full',
							'bg-foreground text-background hover:opacity-90'
						)}
						onClick={e => {
							e.stopPropagation();
							onStop?.();
						}}
						onKeyDown={e => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								e.stopPropagation();
								onStop?.();
							}
						}}
					>
						<Square className="size-2.5 fill-current" />
					</span>
				) : null}
			</button>

			{open ? (
				<ul className="max-h-[40vh] space-y-1.5 overflow-y-auto border-t border-border/40 px-3 py-2">
					{todos.map(todo => (
						<li key={todo.id} className="flex items-start gap-2">
							<span className="mt-0.5">
								<TodoIcon status={todo.status} />
							</span>
							<span
								className={cn(
									'min-w-0 flex-1 wrap-break-word',
									todo.status === 'completed' && 'text-muted-foreground line-through',
									todo.status === 'pending' && 'text-muted-foreground'
								)}
							>
								{todo.content || todo.id}
							</span>
							{todo.status === 'in_progress' && total > 0 ? (
								<span className="shrink-0 text-[11px] text-muted-foreground">
									{completed}/{total}
								</span>
							) : null}
						</li>
					))}
					{todos.length === 0 ? (
						<li className="text-[12px] text-muted-foreground">{t('shell.buildDock.noTodos')}</li>
					) : null}
				</ul>
			) : (
				<div className="mx-3 flex items-center gap-2 border-t border-border/40 py-2">
					{total > 0 && completed === total ? (
						<Check className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
					) : canStop ? (
						<span
							className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
							aria-hidden
						/>
					) : (
						<Circle className="size-3.5 shrink-0 text-muted-foreground/45" aria-hidden />
					)}
					<span className="min-w-0 flex-1 truncate text-muted-foreground">
						{total > 0 && completed === total ? t('shell.buildDock.completed') : currentLabel}
					</span>
					{total > 0 ? (
						<span className="shrink-0 text-[11px] text-muted-foreground">
							{completed}/{total}
						</span>
					) : null}
				</div>
			)}
		</div>
	);
}
