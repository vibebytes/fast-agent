import {useEffect, useId, useState} from 'react';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle
} from '@fast-ide/ui/components/alert-dialog';
import {Button} from '@fast-ide/ui/components/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@fast-ide/ui/components/dialog';
import {Input} from '@fast-ide/ui/components/input';
import {shellT as t} from '../i18n/t';
import {createWorkspaceFile, newFilePath, type FileTreeEntry} from './fileTreeActions';

export type DeleteEntryRequest = {
	entry: FileTreeEntry;
	resolve: (confirmed: boolean) => void;
};

export function NewFileDialog({
	request,
	onClose,
	onCreated
}: {
	request: FileTreeEntry | null;
	onClose: () => void;
	onCreated: (relativePath: string) => void;
}) {
	const [name, setName] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputId = useId();

	useEffect(() => {
		if (!request) return;
		setName('');
		setBusy(false);
		setError(null);
	}, [request]);

	async function create() {
		if (!request || busy) return;
		setBusy(true);
		setError(null);
		try {
			const result = await createWorkspaceFile(request, name, window.fastIde);
			if (!result.ok) {
				setError(result.error);
				setBusy(false);
				return;
			}
			onCreated(result.relativePath ?? newFilePath(request, name));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	}

	return (
		<Dialog
			open={request != null}
			onOpenChange={open => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent className="sm:max-w-md" showCloseButton={!busy}>
				<DialogHeader>
					<DialogTitle>{t('shell.filesMenu.newFileTitle')}</DialogTitle>
					<DialogDescription>{t('shell.filesMenu.newFileDescription')}</DialogDescription>
				</DialogHeader>
				<div className="space-y-2">
					<label htmlFor={inputId} className="text-xs font-medium">
						{t('shell.filesMenu.fileNameLabel')}
					</label>
					<Input
						id={inputId}
						value={name}
						disabled={busy}
						autoFocus
						autoComplete="off"
						placeholder={t('shell.filesMenu.fileNamePlaceholder')}
						onChange={event => setName(event.target.value)}
						onKeyDown={event => {
							if (event.key === 'Enter') {
								event.preventDefault();
								void create();
							}
						}}
					/>
					{error ? <p className="text-xs text-destructive">{error}</p> : null}
				</div>
				<DialogFooter>
					<Button type="button" variant="outline" disabled={busy} onClick={onClose}>
						{t('shell.filesMenu.cancelAction')}
					</Button>
					<Button type="button" disabled={busy || !name.trim()} onClick={() => void create()}>
						{busy
							? t('shell.filesMenu.creating')
							: t('shell.filesMenu.createAction')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function DeleteEntryDialog({
	request,
	onResolve
}: {
	request: DeleteEntryRequest | null;
	onResolve: (confirmed: boolean) => void;
}) {
	const isDir = request?.entry.kind === 'dir';
	return (
		<AlertDialog
			open={request != null}
			onOpenChange={open => {
				if (!open) onResolve(false);
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t(isDir ? 'shell.filesMenu.deleteDirectoryTitle' : 'shell.filesMenu.deleteFileTitle', {
							name: request?.entry.name ?? ''
						})}
					</AlertDialogTitle>
					<AlertDialogDescription className="break-all">
						{t(
							isDir
								? 'shell.filesMenu.deleteDirectoryDescription'
								: 'shell.filesMenu.deleteFileDescription'
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={() => onResolve(false)}>
						{t('shell.filesMenu.cancelAction')}
					</AlertDialogCancel>
					<AlertDialogAction variant="destructive" onClick={() => onResolve(true)}>
						{t('shell.filesMenu.deleteAction')}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
