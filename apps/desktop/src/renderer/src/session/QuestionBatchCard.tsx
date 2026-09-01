import {useEffect, useState} from 'react';
import type {TimelineItem} from '@fast-ide/session-view';
import {Button} from '@fast-ide/ui/components/button';
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from '@fast-ide/ui/components/card';
import {Input} from '@fast-ide/ui/components/input';
import {Spinner} from '@fast-ide/ui/components/spinner';
import {cn} from '@fast-ide/ui/lib/utils';
import {Check, ChevronLeft, ChevronRight, Pencil, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {sendQuestionBatch, usePendingDecision, type PendingDecision} from './pendingDecisions';

type Draft = {selected: string[]; custom: string; skipped: boolean};

const emptyDraft = (): Draft => ({selected: [], custom: '', skipped: false});

/** Display-only: Host still receives the original option label. */
export function parseRecommendedLabel(label: string): {label: string; recommended: boolean} {
	const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
	return suffix.test(label)
		? {label: label.replace(suffix, ''), recommended: true}
		: {label, recommended: false};
}

function answered(d: Draft): boolean {
	return d.selected.length > 0 || d.custom.trim() !== '';
}

export function QuestionBatchCard({
	item,
	scope
}: {
	item: Extract<TimelineItem, {kind: 'question_batch'}>;
	scope: string;
}) {
	const {t} = useTranslation();
	const decision = usePendingDecision(scope, 'questionBatch', item.id);
	const [index, setIndex] = useState(0);
	const [drafts, setDrafts] = useState<Record<string, Draft>>({});
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setIndex(0);
		setDrafts({});
		setError(null);
	}, [item.id]);

	useEffect(() => {
		setIndex(i => Math.min(i, Math.max(0, item.questions.length - 1)));
	}, [item.questions.length]);

	if (decision) {
		return (
			<CompactDecision
				decision={decision}
				summary={item.questions.map(q => q.question).join(' · ')}
			/>
		);
	}

	const last = item.questions.length - 1;
	const question = item.questions[index];
	if (!question) return null;
	const draft = drafts[question.id] ?? emptyDraft();
	const multi = Boolean(question.multiSelect);
	const options = question.options ?? [];
	const approve = question.intent?.kind === 'plan-review' ? question.intent.approve : undefined;

	const update = (next: Draft) => {
		setDrafts(cur => ({...cur, [question.id]: next}));
		setError(null);
	};

	const choose = (label: string) => {
		if (multi) {
			const selected = draft.selected.includes(label)
				? draft.selected.filter(s => s !== label)
				: [...draft.selected, label];
			update({...draft, selected, skipped: false});
			return;
		}
		update({selected: [label], custom: '', skipped: false});
		if (index < last) setIndex(index + 1);
	};

	const setCustom = (custom: string) => {
		update({
			selected: multi ? draft.selected : [],
			custom,
			skipped: false
		});
	};

	const completed = (d: Draft) => answered(d) || d.skipped;

	const answersOf = (map: Record<string, Draft>) =>
		item.questions.map(q => {
			const v = map[q.id] ?? emptyDraft();
			if (v.skipped) return {id: q.id, selected: []};
			const custom = v.custom.trim();
			return {
				id: q.id,
				selected: custom === '' || q.multiSelect ? v.selected : [],
				...(custom ? {custom} : {})
			};
		});

	const submit = (map: Record<string, Draft>) => {
		const missing = item.questions.findIndex(q => !completed(map[q.id] ?? emptyDraft()));
		if (missing >= 0) {
			setIndex(missing);
			setError(t('shell.question.incomplete'));
			return;
		}
		sendQuestionBatch(scope, item.id, {answers: answersOf(map)}, t('shell.question.submit'));
	};

	const skip = () => {
		const nextDrafts = {...drafts, [question.id]: {selected: [], custom: '', skipped: true}};
		setDrafts(nextDrafts);
		setError(null);
		if (index < last) {
			setIndex(index + 1);
			return;
		}
		submit(nextDrafts);
	};

	const goNext = () => {
		if (!answered(draft)) {
			setError(t('shell.question.unanswered'));
			return;
		}
		if (index < last) {
			setIndex(index + 1);
			setError(null);
			return;
		}
		submit(drafts);
	};

	return (
		<Card className="gap-0 overflow-hidden rounded-2xl py-0 shadow-none">
			<CardHeader className="flex-row items-start justify-between gap-3 space-y-0 px-4 pb-0 pt-4">
				<div className="min-w-0">
					{question.header ? (
						<CardDescription className="mb-1 text-[11px] leading-4">
							{question.header}
						</CardDescription>
					) : null}
					<CardTitle className="text-[15px] font-medium leading-snug">{question.question}</CardTitle>
				</div>
				<button
					type="button"
					className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
					aria-label={t('shell.question.dismissAll')}
					title={t('shell.question.dismissAll')}
					onClick={() =>
						sendQuestionBatch(scope, item.id, {cancelled: true}, t('shell.question.cancel'))
					}
				>
					<X className="size-3.5" />
				</button>
			</CardHeader>
			<CardContent className="flex flex-col gap-2 px-4 pb-3 pt-3">
				{question.detail ? (
					<p className="whitespace-pre-wrap text-[12px] leading-snug text-muted-foreground">
						{question.detail}
					</p>
				) : null}
				<div className="flex flex-col" role={multi ? 'group' : 'radiogroup'}>
					{options.map((option, i) => {
						const on = draft.selected.includes(option.label);
						const display = parseRecommendedLabel(option.label);
						const recommended = display.recommended || approve === option.label;
						return (
							<button
								key={`${option.label}-${i}`}
								type="button"
								role={multi ? 'checkbox' : 'radio'}
								aria-checked={on}
								className={cn(
									'flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left',
									'transition-colors hover:bg-muted/50',
									on && 'bg-muted/60'
								)}
								onClick={() => choose(option.label)}
							>
								{multi ? (
									<span
										className={cn(
											'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
											on
												? 'border-foreground bg-foreground text-background'
												: 'border-muted-foreground/40'
										)}
										aria-hidden
									>
										{on ? <Check className="size-3" /> : null}
									</span>
								) : (
									<span
										className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] tabular-nums text-muted-foreground"
										aria-hidden
									>
										{i + 1}
									</span>
								)}
								<span className="min-w-0 text-[13px] leading-snug">
									<span className="font-medium text-foreground">{display.label}</span>
									{recommended ? (
										<span className="ml-1.5 inline-block rounded-sm bg-sky-500/15 px-1 py-px text-[10px] font-medium leading-4 text-sky-700 dark:text-sky-300">
											{t('shell.question.recommended')}
										</span>
									) : null}
									{option.description ? (
										<span className="mt-0.5 block text-[12px] font-normal text-muted-foreground">
											{option.description}
										</span>
									) : null}
								</span>
							</button>
						);
					})}
					{options.length > 0 ? (
						<div
							className={cn(
								'flex items-center gap-2.5 rounded-lg px-2 py-1.5',
								draft.custom !== '' && 'bg-muted/40'
							)}
						>
							{multi ? (
								<span
									className={cn(
										'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
										draft.custom !== ''
											? 'border-foreground bg-foreground text-background'
											: 'border-muted-foreground/40'
									)}
									aria-hidden
								>
									{draft.custom !== '' ? <Check className="size-3" /> : null}
								</span>
							) : (
								<span
									className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
									aria-hidden
								>
									<Pencil className="size-3" />
								</span>
							)}
							<Input
								value={draft.custom}
								onChange={e => setCustom(e.target.value)}
								placeholder={t('shell.question.typeYourAnswer')}
								className="h-7 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0"
								onKeyDown={e => {
									if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
										e.preventDefault();
										goNext();
									}
								}}
							/>
						</div>
					) : (
						<Input
							value={draft.custom}
							onChange={e => setCustom(e.target.value)}
							placeholder={t('shell.question.typeYourAnswer')}
							className="h-8 text-[13px] shadow-none"
							onKeyDown={e => {
								if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
									e.preventDefault();
									goNext();
								}
							}}
						/>
					)}
				</div>
				{error ? <p className="text-[11px] text-destructive">{error}</p> : null}
			</CardContent>
			<CardFooter className="justify-between gap-2 px-4 pb-3 pt-0">
				<div className="flex items-center gap-1 text-[12px] text-muted-foreground">
					<button
						type="button"
						className="rounded-md p-1 hover:bg-muted/60 disabled:opacity-30"
						aria-label={t('shell.question.prev')}
						disabled={index === 0}
						onClick={() => {
							setIndex(index - 1);
							setError(null);
						}}
					>
						<ChevronLeft className="size-3.5" />
					</button>
					<span className="tabular-nums">
						{index + 1} / {item.questions.length}
					</span>
					<button
						type="button"
						className="rounded-md p-1 hover:bg-muted/60 disabled:opacity-30"
						aria-label={t('shell.question.next')}
						disabled={index === last}
						onClick={() => {
							setIndex(index + 1);
							setError(null);
						}}
					>
						<ChevronRight className="size-3.5" />
					</button>
				</div>
				<div className="flex items-center gap-1.5">
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="h-7 rounded-full px-3 text-[12px]"
						onClick={skip}
					>
						{t('shell.question.skip')}
					</Button>
					<Button
						type="button"
						size="sm"
						disabled={!answered(draft)}
						className="h-7 rounded-full px-3 text-[12px]"
						onClick={goNext}
					>
						{index === last ? t('shell.question.submit') : t('shell.question.next')}
					</Button>
				</div>
			</CardFooter>
		</Card>
	);
}

function CompactDecision({decision, summary}: {decision: PendingDecision; summary: string}) {
	const denied = decision.approved === false;
	const Icon = denied ? X : Check;
	return (
		<div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[13px]">
			<Icon
				className={cn('size-3.5 shrink-0', denied ? 'text-destructive' : 'text-muted-foreground')}
			/>
			<span className="shrink-0 font-medium text-foreground">{decision.label}</span>
			<span className="min-w-0 truncate text-muted-foreground">{summary}</span>
			{decision.failed ? (
				<span className="ml-auto shrink-0 text-[11px] text-destructive">{decision.failed}</span>
			) : (
				<Spinner className="ml-auto size-3 shrink-0" />
			)}
		</div>
	);
}
