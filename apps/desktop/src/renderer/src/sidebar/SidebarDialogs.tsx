import {useEffect, useId, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
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
import type {ProjectSnapshot, TaskSummary} from '../env';

export type SidebarDialogState =
	| {kind: 'none'}
	| {kind: 'renameProject'; project: ProjectSnapshot; initialName: string}
	| {kind: 'renameTask'; task: TaskSummary; initialName: string; projectPath: string}
	| {kind: 'confirmArchiveTask'; project: ProjectSnapshot; task: TaskSummary}
	| {kind: 'confirmArchiveAll'; project: ProjectSnapshot; count: number; displayName: string}
	| {kind: 'confirmDeleteTask'; project: ProjectSnapshot; task: TaskSummary}
	| {kind: 'confirmRemoveProject'; project: ProjectSnapshot; displayName: string};

export const SIDEBAR_DIALOG_NONE: SidebarDialogState = {kind: 'none'};

export function SidebarDialogs({
	dialog,
	onOpenChange,
	onRenameProject,
	onRenameTask,
	onArchiveTask,
	onArchiveAll,
	onDeleteTask,
	onRemoveProject
}: {
	dialog: SidebarDialogState;
	onOpenChange: (open: boolean) => void;
	onRenameProject: (project: ProjectSnapshot, name: string) => void | Promise<void>;
	onRenameTask: (task: TaskSummary, name: string, projectPath: string) => void | Promise<void>;
	onArchiveTask: (project: ProjectSnapshot, task: TaskSummary) => void;
	onArchiveAll: (project: ProjectSnapshot) => void;
	onDeleteTask: (project: ProjectSnapshot, task: TaskSummary) => void | Promise<void>;
	onRemoveProject: (project: ProjectSnapshot) => void;
}) {
	const {t} = useTranslation();
	const close = () => onOpenChange(false);
	/** Snapshot at confirm time — AlertDialog close can clear `dialog` before onClick runs. */
	const confirm = (action: (current: SidebarDialogState) => void) => {
		const current = dialog;
		close();
		action(current);
	};

	return (
		<>
			<RenameDialog
				open={dialog.kind === 'renameProject' || dialog.kind === 'renameTask'}
				title={
					dialog.kind === 'renameProject'
						? t('shell.sidebarDialog.renameProject')
						: t('shell.sidebarDialog.renameTask')
				}
				description={
					dialog.kind === 'renameProject'
						? t('shell.sidebarDialog.renameProjectHint')
						: t('shell.sidebarDialog.renameTaskHint')
				}
				initialName={
					dialog.kind === 'renameProject' || dialog.kind === 'renameTask'
						? dialog.initialName
						: ''
				}
				onOpenChange={open => {
					if (!open) close();
				}}
				onSave={name => {
					if (dialog.kind === 'renameProject') void onRenameProject(dialog.project, name);
					else if (dialog.kind === 'renameTask')
						void onRenameTask(dialog.task, name, dialog.projectPath);
					close();
				}}
			/>

			<ConfirmDialog
				open={dialog.kind === 'confirmArchiveTask'}
				title={
					dialog.kind === 'confirmArchiveTask'
						? t('shell.sidebarDialog.archiveTaskTitle', {title: dialog.task.title})
						: ''
				}
				description={t('shell.sidebarDialog.archiveTaskDesc')}
				actionLabel={t('shell.sidebarDialog.archiveAction')}
				onOpenChange={open => {
					if (!open) close();
				}}
				onConfirm={() =>
					confirm(current => {
						if (current.kind === 'confirmArchiveTask')
							onArchiveTask(current.project, current.task);
					})
				}
			/>

			<ConfirmDialog
				open={dialog.kind === 'confirmArchiveAll'}
				title={
					dialog.kind === 'confirmArchiveAll'
						? t('shell.sidebarDialog.archiveAllTitle', {name: dialog.displayName})
						: ''
				}
				description={
					dialog.kind === 'confirmArchiveAll'
						? t('shell.sidebarDialog.archiveAllDesc', {count: dialog.count})
						: ''
				}
				actionLabel={t('shell.sidebarDialog.archiveAllAction')}
				onOpenChange={open => {
					if (!open) close();
				}}
				onConfirm={() =>
					confirm(current => {
						if (current.kind === 'confirmArchiveAll') onArchiveAll(current.project);
					})
				}
			/>

			<ConfirmDialog
				open={dialog.kind === 'confirmDeleteTask'}
				title={
					dialog.kind === 'confirmDeleteTask'
						? t('shell.sidebarDialog.deleteTaskTitle', {title: dialog.task.title})
						: ''
				}
				description={t('shell.sidebarDialog.deleteTaskDesc')}
				actionLabel={t('shell.sidebarDialog.deleteAction')}
				destructive
				onOpenChange={open => {
					if (!open) close();
				}}
				onConfirm={() =>
					confirm(current => {
						if (current.kind === 'confirmDeleteTask')
							void onDeleteTask(current.project, current.task);
					})
				}
			/>

			<ConfirmDialog
				open={dialog.kind === 'confirmRemoveProject'}
				title={
					dialog.kind === 'confirmRemoveProject'
						? t('shell.sidebarDialog.removeProjectTitle', {name: dialog.displayName})
						: ''
				}
				description={t('shell.sidebarDialog.removeProjectDesc')}
				actionLabel={t('shell.sidebarDialog.removeAction')}
				destructive
				onOpenChange={open => {
					if (!open) close();
				}}
				onConfirm={() =>
					confirm(current => {
						if (current.kind === 'confirmRemoveProject')
							onRemoveProject(current.project);
					})
				}
			/>
		</>
	);
}

function RenameDialog({
	open,
	title,
	description,
	initialName,
	onOpenChange,
	onSave
}: {
	open: boolean;
	title: string;
	description: string;
	initialName: string;
	onOpenChange: (open: boolean) => void;
	onSave: (name: string) => void;
}) {
	const {t} = useTranslation();
	const [name, setName] = useState(initialName);
	const inputRef = useRef<HTMLInputElement>(null);
	const inputId = useId();

	useEffect(() => {
		if (!open) return;
		setName(initialName);
		const id = window.setTimeout(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		}, 0);
		return () => window.clearTimeout(id);
	}, [open, initialName]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-5 rounded-2xl sm:max-w-md" showCloseButton>
				<DialogHeader className="gap-1.5 text-left">
					<DialogTitle className="text-base font-semibold tracking-tight">{title}</DialogTitle>
					<DialogDescription className="text-sm text-muted-foreground">
						{description}
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-2">
					<label htmlFor={inputId} className="sr-only">
						{t('shell.sidebarDialog.name')}
					</label>
					<Input
						ref={inputRef}
						id={inputId}
						value={name}
						onChange={e => setName(e.target.value)}
						onKeyDown={e => {
							if (e.key === 'Enter') {
								e.preventDefault();
								onSave(name.trim() || initialName);
							}
						}}
					/>
				</div>
				<DialogFooter className="gap-2 sm:gap-2">
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t('shell.sidebarDialog.cancel')}
					</Button>
					<Button type="button" onClick={() => onSave(name.trim() || initialName)}>
						{t('shell.sidebarDialog.save')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ConfirmDialog({
	open,
	title,
	description,
	actionLabel,
	destructive,
	onOpenChange,
	onConfirm
}: {
	open: boolean;
	title: string;
	description: string;
	actionLabel: string;
	destructive?: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	const {t} = useTranslation();
	/** Guard Slot/Action composing the same click twice (→ delete then "Task not found"). */
	const lockedRef = useRef(false);
	useEffect(() => {
		if (open) lockedRef.current = false;
	}, [open]);

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{t('shell.sidebarDialog.cancel')}</AlertDialogCancel>
					<AlertDialogAction
						variant={destructive ? 'destructive' : 'default'}
						onClick={() => {
							if (lockedRef.current) return;
							lockedRef.current = true;
							onConfirm();
						}}
					>
						{actionLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
