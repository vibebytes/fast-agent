import {WindowFrame} from '@fast-ide/ui/components/window-frame';

export function TerminalPane({title}: {title: string}) {
	return (
		<div className="flex h-full min-h-0 flex-col p-2">
			<WindowFrame variant="terminal" title={title} className="flex min-h-0 flex-1 flex-col">
				<pre className="min-h-0 flex-1 overflow-auto px-3 py-2 text-muted-foreground">
					{`$ # Integrated terminal is not wired yet\n$ # Use + → Terminal to open another session tab\n`}
				</pre>
			</WindowFrame>
		</div>
	);
}
