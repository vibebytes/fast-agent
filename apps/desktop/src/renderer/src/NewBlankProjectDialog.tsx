import {useEffect, useId, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
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

const DEFAULT_NAME = 'New project';

export function NewBlankProjectDialog({
	open,
	onOpenChange
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const {t} = useTranslation();
	const [name, setName] = useState(DEFAULT_NAME);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const inputId = useId();

	useEffect(() => {
		if (!open) return;
		setName(DEFAULT_NAME);
		setError(null);
		setBusy(false);
		const id = window.setTimeout(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		}, 0);
		return () => window.clearTimeout(id);
	}, [open]);

	async function save() {
		const trimmed = name.trim() || DEFAULT_NAME;
		setBusy(true);
		setError(null);
		try {
			const path = await window.fastIde.createBlankProject(trimmed);
			if (!path) {
				setError(t('shell.newProject.createFailed'));
				setBusy(false);
				return;
			}
			onOpenChange(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-5 rounded-2xl sm:max-w-md" showCloseButton>
				<DialogHeader className="gap-1.5 text-left">
					<DialogTitle className="text-base font-semibold tracking-tight">
						{t('shell.newProject.title')}
					</DialogTitle>
					<DialogDescription className="text-sm text-muted-foreground">
						{t('shell.newProject.subtitle')}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-2">
					<label htmlFor={inputId} className="sr-only">
						{t('shell.newProject.nameLabel')}
					</label>
					<Input
						ref={inputRef}
						id={inputId}
						value={name}
						disabled={busy}
						onChange={e => setName(e.target.value)}
						onKeyDown={e => {
							if (e.key === 'Enter') {
								e.preventDefault();
								void save();
							}
						}}
						className="h-10 rounded-lg"
						autoComplete="off"
					/>
					{error ? <p className="text-xs text-destructive">{error}</p> : null}
					<p className="text-[11px] text-muted-foreground">{t('shell.newProject.docsHint')}</p>
				</div>

				<DialogFooter className="gap-2 sm:justify-end">
					<Button
						type="button"
						variant="outline"
						disabled={busy}
						onClick={() => onOpenChange(false)}
					>
						{t('shell.newProject.cancel')}
					</Button>
					<Button type="button" disabled={busy} onClick={() => void save()}>
						{busy ? t('shell.newProject.saving') : t('shell.newProject.save')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
