import {WindowFrame} from '@fast-ide/ui/components/window-frame';
import {shellT as t} from '../../i18n/t';
import {ToolOutputPreview} from '../../ToolOutputPreview';
import {classifyToolOutcome} from '../../toolPresentation';

export type DshToolCardView = {
	name: string;
	title: string;
	args: Record<string, string>;
	result?: string;
	status?: 'running' | 'success' | 'error' | 'cancelled';
};

export function DshToolCard({card}: {card: DshToolCardView}) {
	const args = Object.entries(card.args)
		.map(([k, v]) => `${k}: ${v}`)
		.join('\n');
	const outcome = classifyToolOutcome({status: card.status ?? 'success', output: card.result});
	const baseTitle = card.title || card.name;

	return (
		<WindowFrame
			variant="terminal"
			title={baseTitle}
			preview={
				card.status !== 'success' && card.result ? (
					<ToolOutputPreview output={card.result} />
				) : undefined
			}
			titleShimmer={card.status === 'running'}
			trailing={
				outcome.tone === 'error' ? (
					<span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-red-600/90 dark:text-red-400/90">
						<span aria-hidden className="size-1.5 shrink-0 rounded-full bg-red-500/80" />
						{t('shell.toolCard.failed')}
					</span>
				) : outcome.label === 'cancelled' ? (
					<span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
						<span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
						{t('shell.toolCard.cancelled')}
					</span>
				) : undefined
			}
			collapsible
			defaultOpen={card.status === 'running'}
			className="w-full"
		>
			{args ? <pre className="whitespace-pre-wrap px-2 py-1 text-[11px]">{args}</pre> : null}
			{card.result ? (
				<pre className="whitespace-pre-wrap border-t border-border px-2 py-1 text-[11px]">{card.result}</pre>
			) : null}
		</WindowFrame>
	);
}
