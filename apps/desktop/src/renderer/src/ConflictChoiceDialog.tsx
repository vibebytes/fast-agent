import {Button} from '@fast-ide/ui/components/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@fast-ide/ui/components/dialog';
import type {ConflictChoice} from './documentMerge';

export type ConflictChoiceRequest = {
	path: string;
	resolve: (choice: ConflictChoice) => void;
};

/** Non-blocking 3-way conflict chooser (replaces window.prompt). */
export function ConflictChoiceDialog({
	request,
	onSettled
}: {
	request: ConflictChoiceRequest | null;
	onSettled: () => void;
}) {
	const finish = (choice: ConflictChoice) => {
		request?.resolve(choice);
		onSettled();
	};

	return (
		<Dialog
			open={request != null}
			onOpenChange={open => {
				if (!open) finish('cancel');
			}}
		>
			<DialogContent className="sm:max-w-md" showCloseButton>
				<DialogHeader>
					<DialogTitle>File changed on disk</DialogTitle>
					<DialogDescription className="font-mono text-xs break-all">
						{request?.path}
					</DialogDescription>
				</DialogHeader>
				<p className="text-sm text-muted-foreground">
					Your buffer has unsaved edits and the file was updated outside this editor.
				</p>
				<DialogFooter className="flex-col gap-2 sm:flex-col">
					<Button type="button" className="w-full" onClick={() => finish('merge')}>
						Merge (3-way)
					</Button>
					<Button
						type="button"
						variant="secondary"
						className="w-full"
						onClick={() => finish('disk')}
					>
						Use disk
					</Button>
					<Button
						type="button"
						variant="secondary"
						className="w-full"
						onClick={() => finish('mine')}
					>
						Use mine
					</Button>
					<Button
						type="button"
						variant="outline"
						className="w-full"
						onClick={() => finish('cancel')}
					>
						Cancel
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
