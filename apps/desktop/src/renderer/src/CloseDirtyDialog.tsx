import {Button} from '@fast-ide/ui/components/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@fast-ide/ui/components/dialog';
import type {CloseDirtyChoice} from './documentMerge';

export type CloseDirtyRequest = {
	title: string;
	resolve: (choice: CloseDirtyChoice) => void;
};

/** Non-blocking unsaved-close chooser (Electron has no window.prompt). */
export function CloseDirtyDialog({
	request,
	onSettled
}: {
	request: CloseDirtyRequest | null;
	onSettled: () => void;
}) {
	const finish = (choice: CloseDirtyChoice) => {
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
					<DialogTitle>Unsaved changes</DialogTitle>
					<DialogDescription className="break-all">
						&ldquo;{request?.title}&rdquo; has unsaved changes.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter className="flex-col gap-2 sm:flex-col">
					<Button
						type="button"
						variant="destructive"
						className="w-full"
						onClick={() => finish('discard')}
					>
						Discard
					</Button>
					<Button type="button" className="w-full" onClick={() => finish('save')}>
						Save
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
