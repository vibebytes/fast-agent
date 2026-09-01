import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ChevronUp, Folder, FolderPlus, Home, LoaderCircle} from 'lucide-react';
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
import type {HostDirEntry} from '@fast-ide/session-view';
import {hostDirName, parentRemotePath} from '../../shared/remotePath';

export function RemoteFolderDialog({
	open,
	onOpenChange
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const {t} = useTranslation();
	const [path, setPath] = useState('');
	const [home, setHome] = useState('');
	const [entries, setEntries] = useState<HostDirEntry[]>([]);
	const [tree, setTree] = useState<'ok' | 'loading' | 'fallback' | 'timeout'>('loading');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState('');
	const [creatingDir, setCreatingDir] = useState(false);

	useEffect(() => {
		if (!open) return;
		setError(null);
		setBusy(false);
		setCreating(false);
		setNewName('');
		void window.fastIde.listEdges().then(list => {
			const start = list.hostHome ?? '';
			setHome(start);
			setPath(start);
			void browse(start);
		});
	}, [open]);

	async function browse(next?: string) {
		setTree('loading');
		const res = await window.fastIde.listHostDir(next);
		if (!res.ok) {
			if (res.fallback || res.code === 'timeout') {
				setTree(res.fallback ? 'fallback' : 'timeout');
				if (res.home) {
					setHome(res.home);
					if (!path) setPath(res.home);
				}
				return;
			}
			setTree('ok');
			setEntries([]);
			setError(res.error);
			if (res.home) setHome(res.home);
			return;
		}
		setError(null);
		setTree('ok');
		setPath(res.path);
		setHome(res.home);
		setEntries(res.entries);
	}

	async function createFolder() {
		const parent = path.trim();
		const name = hostDirName(newName);
		if (!parent || !name) {
			setError(t('shell.remoteFolder.invalidName'));
			return;
		}
		setCreatingDir(true);
		setError(null);
		const res = await window.fastIde.createHostDir(parent, name);
		setCreatingDir(false);
		if (!res.ok) {
			const key =
				res.code === 'invalid'
					? 'shell.remoteFolder.invalidName'
					: res.code === 'exists'
						? 'shell.remoteFolder.exists'
						: res.code === 'denied'
							? 'shell.remoteFolder.createDenied'
							: res.code === 'unknown-command'
								? 'shell.remoteFolder.createUnknown'
								: res.code === 'timeout'
									? 'shell.remoteFolder.createTimeout'
									: 'shell.remoteFolder.createFailed';
			setError(t(key));
			return;
		}
		setCreating(false);
		setNewName('');
		setPath(res.path);
		await browse(res.path);
	}

	async function confirm() {
		const target = path.trim();
		if (!target) return;
		setBusy(true);
		setError(null);
		try {
			const opened = await window.fastIde.openRemoteProject(target);
			if (!opened) {
				setError(t('shell.remoteFolder.openFailed'));
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
			<DialogContent className="gap-4 sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{t('shell.remoteFolder.title')}</DialogTitle>
					<DialogDescription>{t('shell.remoteFolder.subtitle')}</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<Input
						value={path}
						disabled={busy || creatingDir}
						onChange={e => setPath(e.target.value)}
						onKeyDown={e => {
							if (e.key === 'Enter') void browse(path);
						}}
					/>
					{tree !== 'fallback' && tree !== 'timeout' ? (
						<div className="flex flex-wrap gap-1">
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={busy || creatingDir || !home}
								onClick={() => void browse(home)}
							>
								<Home className="size-3.5" />
								{t('shell.remoteFolder.home')}
							</Button>
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={busy || creatingDir || !path}
								onClick={() => void browse(parentRemotePath(path))}
							>
								<ChevronUp className="size-3.5" />
								{t('shell.remoteFolder.up')}
							</Button>
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={busy || creatingDir || !path.trim() || tree !== 'ok'}
								onClick={() => {
									setCreating(true);
									setError(null);
								}}
							>
								<FolderPlus className="size-3.5" />
								{t('shell.remoteFolder.create')}
							</Button>
						</div>
					) : (
						<p className="text-xs text-muted-foreground">
							{t(tree === 'timeout' ? 'shell.remoteFolder.timeout' : 'shell.remoteFolder.fallback')}
						</p>
					)}
					{creating && tree === 'ok' ? (
						<div className="flex gap-1">
							<Input
								autoFocus
								value={newName}
								disabled={creatingDir}
								placeholder={t('shell.remoteFolder.namePlaceholder')}
								onChange={e => setNewName(e.target.value)}
								onKeyDown={e => {
									if (e.key === 'Enter') void createFolder();
									if (e.key === 'Escape') {
										setCreating(false);
										setNewName('');
									}
								}}
							/>
							<Button
								type="button"
								size="sm"
								disabled={creatingDir || !hostDirName(newName)}
								onClick={() => void createFolder()}
							>
								{creatingDir ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
								{t('shell.remoteFolder.createConfirm')}
							</Button>
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={creatingDir}
								onClick={() => {
									setCreating(false);
									setNewName('');
								}}
							>
								{t('shell.remoteFolder.cancelCreate')}
							</Button>
						</div>
					) : null}
					{tree === 'loading' ? (
						<div className="flex h-40 items-center justify-center text-muted-foreground">
							<LoaderCircle className="size-4 animate-spin" />
						</div>
					) : tree === 'ok' ? (
						<div className="max-h-56 overflow-auto rounded-md border">
							{entries.length === 0 ? (
								<p className="px-3 py-6 text-center text-xs text-muted-foreground">
									{t('shell.remoteFolder.empty')}
								</p>
							) : (
								entries.map(entry => (
									<button
										key={entry.path}
										type="button"
										className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/50"
										disabled={busy || creatingDir}
										onClick={() => {
											setPath(entry.path);
											void browse(entry.path);
										}}
									>
										<Folder className="size-3.5 text-muted-foreground" />
										<span className="truncate">{entry.name}</span>
									</button>
								))
							)}
						</div>
					) : null}
					{error ? <p className="text-xs text-destructive">{error}</p> : null}
				</div>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t('shell.remoteFolder.cancel')}
					</Button>
					<Button type="button" disabled={busy || creatingDir || !path.trim()} onClick={() => void confirm()}>
						{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
						{t('shell.remoteFolder.open')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
