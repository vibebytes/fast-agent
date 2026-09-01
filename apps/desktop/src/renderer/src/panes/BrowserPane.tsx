import {useState} from 'react';
import {Button} from '@fast-ide/ui/components/button';
import {Input} from '@fast-ide/ui/components/input';
import {Globe} from 'lucide-react';
import type {RailTab} from '../railTabs';

export function BrowserPane({
	tab,
	onPatch
}: {
	tab: RailTab;
	onPatch: (patch: Partial<RailTab>) => void;
}) {
	const [draft, setDraft] = useState(tab.url ?? 'https://');
	const src = tab.url && /^https?:\/\//i.test(tab.url) ? tab.url : undefined;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<form
				className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5"
				onSubmit={e => {
					e.preventDefault();
					let next = draft.trim();
					if (next && !/^https?:\/\//i.test(next)) next = `https://${next}`;
					onPatch({url: next, title: (() => {
						try {
							return next ? new URL(next).hostname : 'Browser';
						} catch {
							return 'Browser';
						}
					})()});
				}}
			>
				<Globe className="size-3.5 shrink-0 text-muted-foreground" />
				<Input
					value={draft}
					onChange={e => setDraft(e.target.value)}
					placeholder="https://"
					className="h-7 border-0 bg-transparent shadow-none focus-visible:ring-0"
				/>
				<Button type="submit" size="xs" variant="secondary">
					Go
				</Button>
			</form>
			{src ? (
				<iframe title={tab.title} src={src} className="min-h-0 flex-1 border-0 bg-background" />
			) : (
				<div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
					Enter a URL and press Go to load a page.
				</div>
			)}
		</div>
	);
}
