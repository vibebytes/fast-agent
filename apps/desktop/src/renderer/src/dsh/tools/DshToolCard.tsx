import {WindowFrame} from '@fast-ide/ui/components/window-frame';
import {extractErrorDiagnostic} from '../../toolPresentation';

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
	const errorDiagnostic = card.status === 'error' ? extractErrorDiagnostic(card.result) : null;
	const baseTitle = card.title || card.name;
	const titleNode = errorDiagnostic ? (
		<span className="flex min-w-0 max-w-full items-baseline gap-2 truncate">
			<span className="truncate">{baseTitle}</span>
			<span className="hidden sm:inline truncate text-[11px] font-normal text-muted-foreground/85">
				— {errorDiagnostic}
			</span>
		</span>
	) : (
		baseTitle
	);

	return (
		<WindowFrame
			variant="terminal"
			tone={card.status === 'error' ? 'error' : undefined}
			title={titleNode}
			titleShimmer={card.status === 'running'}
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
