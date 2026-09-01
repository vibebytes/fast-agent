import {Button} from '@fast-ide/ui/components/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@fast-ide/ui/components/dialog';

/**
 * Dirty-buffer gate for Keep (review-diff-batch-hunks §5.3).
 *
 * Keep records the fingerprint of what is on disk and does not write the file. Unsaved editor
 * text is therefore not part of the record — and a later reload or close will drop it. Asking
 * here is what stops that from happening silently.
 */
export function KeepConfirm({
	paths,
	busy,
	onCancel,
	onConfirm
}: {
	paths: readonly string[];
	busy: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	return (
		<Dialog open onOpenChange={open => !open && onCancel()}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Keep the agent's change?</DialogTitle>
					<DialogDescription>
						These files have unsaved edits. Keep accepts what is already on disk, not the
						text in the editor. Closing or reloading the tab discards that buffer.
					</DialogDescription>
				</DialogHeader>
				<ul className="max-h-40 space-y-1 overflow-auto font-mono text-xs">
					{paths.map(path => (
						<li key={path} className="truncate">
							{path}
						</li>
					))}
				</ul>
				<DialogFooter>
					<Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
						Keep my edits
					</Button>
					<Button type="button" size="sm" onClick={onConfirm} disabled={busy}>
						Discard and keep
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
