import {useMemo, useState} from 'react';
import type {TimelineItem} from '@fast-ide/session-view';
import {Button} from '@fast-ide/ui/components/button';
import {cn} from '@fast-ide/ui/lib/utils';
import {AlertTriangle, ChevronDown, ChevronRight, Copy, Check, RotateCcw, SkipForward} from 'lucide-react';
import {useTranslation} from 'react-i18next';

type Fault = NonNullable<Extract<TimelineItem, {kind: 'assistant'}>['fault']>;

/**
 * P1a/P3 error card for a failed assistant run. Affordances follow the fault
 * contract: Retry when remedy === 'retry_same' (conservatively always for
 * third-party engines that carry no structured fault), Continue only when the
 * failure left accepted turns behind, plus copy/details. `stale` (D10) hides
 * every action once a newer terminal exists — title + details remain.
 */
export function ErrorCardRow({
	fault,
	text,
	runId,
	busy,
	stale,
	onRetry,
	onContinue
}: {
	fault?: Fault;
	text?: string;
	runId: string;
	busy: boolean;
	stale?: boolean;
	onRetry: (runId: string) => void;
	onContinue: () => void;
}) {
	const {t} = useTranslation();
	const [copied, setCopied] = useState(false);
	const [detailsOpen, setDetailsOpen] = useState(false);
	// Doc §7 matrix: Retry ⇔ remedy === 'retry_same'. RetryAmended faults
	// (Malformed/Truncated/Empty(false)/context_length) carry no retryableAfterMs.
	// No structured fault (third-party engine): retry conservatively, hide Continue.
	const retryable = fault ? fault.remedy === 'retry_same' : true;

	const rawText = useMemo(() => (text ?? '').trim(), [text]);
	const summary = useMemo(() => {
		const firstLine = rawText.split('\n').find(l => l.trim().length > 0);
		return firstLine?.slice(0, 400) ?? '';
	}, [rawText]);
	const friendlyHint =
		fault && (fault.kind === 'transport' || fault.kind === 'availability' || fault.kind === 'config')
			? t(`errors.hint.${fault.kind}`, {defaultValue: ''})
			: '';
	const primary = friendlyHint || summary;
	const showDebug = Boolean(friendlyHint && rawText);

	const copyError = async () => {
		try {
			await navigator.clipboard.writeText(
				[fault?.kind, fault?.remedy, friendlyHint || summary, rawText].filter(Boolean).join('\n')
			);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			/* clipboard unavailable — ignore */
		}
	};

	return (
		<div
			className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5"
			data-testid={`error-card-${runId}`}
		>
			<div className="flex items-center gap-2">
				<AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
				<span className="text-[13px] font-medium text-destructive">
					{t('session.errorCard.title')}
				</span>
				{typeof fault?.attempts === 'number' && fault.attempts > 1 ? (
					<span className="text-[11px] text-muted-foreground">
						{t('session.errorCard.attempts', {attempts: fault.attempts})}
					</span>
				) : null}
				<button
					type="button"
					onClick={() => setDetailsOpen(o => !o)}
					className="ml-auto flex items-center gap-0.5 text-[12px] text-muted-foreground hover:text-foreground"
				>
					{detailsOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
					{t('session.errorCard.details')}
				</button>
			</div>

			{primary ? (
				<p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words font-mono text-[12px] text-muted-foreground">
					{primary}
				</p>
			) : null}

			{detailsOpen ? (
				<div className="mt-2 space-y-1 border-t border-destructive/20 pt-2">
					{fault ? (
						<>
							<div className="flex gap-2 text-[12px]">
								<span className="shrink-0 text-muted-foreground">{t('session.errorCard.kind')}</span>
								<span className="font-mono">{t(`errors.kind.${fault.kind}`, {defaultValue: fault.kind})}</span>
							</div>
							{fault.remedy ? (
								<div className="flex gap-2 text-[12px]">
									<span className="shrink-0 text-muted-foreground">{t('session.errorCard.remedy')}</span>
									<span>{t(`errors.remedy.${fault.remedy}`, {defaultValue: fault.remedy})}</span>
								</div>
							) : null}
						</>
					) : null}
					{showDebug ? (
						<div className="flex flex-col gap-1 text-[12px]">
							<span className="shrink-0 text-muted-foreground">{t('session.errorCard.debug')}</span>
							<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-muted-foreground">
								{rawText.slice(0, 4000)}
							</pre>
						</div>
					) : null}
				</div>
			) : null}

			{stale ? null : (
				<div className={cn('mt-2 flex items-center gap-2', detailsOpen && 'border-t border-destructive/20 pt-2')}>
					{retryable ? (
					<Button
						variant="outline"
						size="sm"
						className="h-7 gap-1.5 px-2.5 text-[12px]"
						disabled={busy}
						onClick={() => onRetry(runId)}
					>
						<RotateCcw className="size-3.5" />
						{t('session.errorCard.retry')}
					</Button>
				) : null}
				{typeof fault?.acceptedTurns === 'number' && fault.acceptedTurns > 0 ? (
					<Button
						variant="outline"
						size="sm"
						className="h-7 gap-1.5 px-2.5 text-[12px]"
						disabled={busy}
						onClick={onContinue}
					>
						<SkipForward className="size-3.5" />
						{t('session.errorCard.continue')}
					</Button>
				) : null}
				<Button
					variant="ghost"
					size="sm"
					className="ml-auto h-7 gap-1.5 px-2 text-[12px] text-muted-foreground"
					onClick={copyError}
				>
					{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
					{copied ? t('session.errorCard.copied') : t('session.errorCard.copy')}
				</Button>
				</div>
			)}
		</div>
	);
}
