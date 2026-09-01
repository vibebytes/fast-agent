import {WindowFrame} from '@fast-ide/ui/components/window-frame';

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
	return (
		<WindowFrame
			variant="terminal"
			title={card.title || card.name}
			titleShimmer={card.status === 'running'}
			collapsible
			defaultOpen={card.status === 'running' || card.status === 'error'}
			className="w-full"
		>
			{args ? <pre className="whitespace-pre-wrap px-2 py-1 text-[11px]">{args}</pre> : null}
			{card.result ? (
				<pre className="whitespace-pre-wrap border-t border-border px-2 py-1 text-[11px]">{card.result}</pre>
			) : null}
		</WindowFrame>
	);
}
