import {useTranslation} from 'react-i18next';
import {useEffect, useState} from 'react';
import {type PlanTodoStatus, type TimelineItem} from '@fast-ide/session-view';
import {Button} from '@fast-ide/ui/components/button';
import {cn} from '@fast-ide/ui/lib/utils';
import {Check, ChevronDown, ChevronUp, Circle, LoaderCircle} from 'lucide-react';
import {StreamingMarkdownMessage} from '../MarkdownMessage';

type PlanItem = Extract<TimelineItem, {kind: 'plan'}>;

function TodoIcon({status}: {status: PlanTodoStatus}) {
	if (status === 'completed') {
		return <Check className="size-3.5 shrink-0 text-muted-foreground" aria-label="completed" />;
	}
	if (status === 'in_progress') {
		return (
			<LoaderCircle
				className="size-3.5 shrink-0 animate-spin text-foreground/70"
				aria-label="in progress"
			/>
		);
	}
	return <Circle className="size-3.5 shrink-0 text-muted-foreground/50" aria-label="pending" />;
}

export type PlanBuildHost = {
	setRunMode: (mode: string) => Promise<boolean>;
	/** UI Build → PlanBuild Submit (plan_build message + dock). */
	buildPlan: (planId: string, name?: string) => Promise<{ok: boolean}>;
};

/**
 * Build = SetMode(agent) + Submit with planBuild payload.
 */
export async function buildPlan(
	planId: string,
	name = '',
	host: PlanBuildHost = window.fastIde as unknown as PlanBuildHost
): Promise<boolean> {
	const modeOk = await host.setRunMode('agent');
	if (!modeOk) return false;
	const result = await host.buildPlan(planId, name);
	return result.ok;
}

/** Flat Session Plan card — timeline-inline Created Plan (not Build Dock). */
export function PlanCard({
	item,
	/** True while a PlanBuild turn for this planId is in-flight (Dock Stop visible). */
	buildActive = false
}: {
	item: PlanItem;
	buildActive?: boolean;
}) {
	const {t} = useTranslation();
	const [bodyOpen, setBodyOpen] = useState(false);
	/** Optimistic / Q16 lock after socket accept; cleared only on send fail or reject timeout. */
	const [building, setBuilding] = useState(false);
	const [pending, setPending] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const hasBody = item.body.trim().length > 0;
	const title = item.name.trim() || 'Plan';
	const showBuilding = building || buildActive;

	useEffect(() => {
		if (buildActive) {
			setPending(false);
			setBuilding(true); // Q16: stay Building… once the execute turn is visible
		}
	}, [buildActive]);

	// Socket accepted but turn never started (input_rejected / busy) → unlock Build.
	useEffect(() => {
		if (!pending || buildActive) return;
		const timer = window.setTimeout(() => {
			setPending(false);
			setBuilding(false);
			setNotice(t('shell.plan.buildNotStarted'));
		}, 4000);
		return () => window.clearTimeout(timer);
	}, [pending, buildActive, t]);

	const onBuild = () => {
		setBuilding(true);
		setPending(true);
		setNotice(null);
		void buildPlan(item.planId, item.name).then(ok => {
			if (!ok) {
				setPending(false);
				setBuilding(false);
				setNotice(t('shell.plan.buildSendFailed'));
			}
			// Keep Building… after success (Q16); reject path clears via timeout / !buildActive.
		});
	};

	return (
		<div
			className={cn(
				'w-full rounded-xl border border-border/60 bg-background/80',
				'px-3 py-2.5 text-[13px] leading-relaxed text-foreground'
			)}
		>
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					<p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
						Created Plan
					</p>
					<p className="mt-0.5 text-[14px] font-medium text-foreground">{title}</p>
					{item.overview.trim() ? (
						<p className="mt-0.5 text-[13px] text-muted-foreground">{item.overview}</p>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{hasBody ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="h-7 gap-1 px-2 text-[12px] text-muted-foreground"
							onClick={() => setBodyOpen(v => !v)}
						>
							{bodyOpen ? (
								<>
									<ChevronUp className="size-3.5" />
									Hide
								</>
							) : (
								<>
									<ChevronDown className="size-3.5" />
									View Plan
								</>
							)}
						</Button>
					) : null}
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="h-7 px-2.5 text-[12px]"
						disabled={showBuilding}
						onClick={onBuild}
					>
						{showBuilding ? 'Building…' : 'Build'}
					</Button>
				</div>
			</div>

			{bodyOpen && hasBody ? (
				<div className="mt-2 border-t border-border/50 pt-2">
					<StreamingMarkdownMessage text={item.body} streaming={false} />
				</div>
			) : null}

			{item.todos.length > 0 ? (
				<ul className="mt-2 space-y-1 border-t border-border/50 pt-2">
					{item.todos.map(todo => (
						<li key={todo.id} className="flex items-start gap-2 text-[13px]">
							<span className="mt-0.5">
								<TodoIcon status={todo.status} />
							</span>
							<span
								className={cn(
									'min-w-0 wrap-break-word',
									todo.status === 'completed' && 'text-muted-foreground line-through'
								)}
							>
								{todo.content || todo.id}
							</span>
						</li>
					))}
				</ul>
			) : null}

			{notice ? <p className="mt-1.5 text-[12px] text-destructive">{notice}</p> : null}
		</div>
	);
}
