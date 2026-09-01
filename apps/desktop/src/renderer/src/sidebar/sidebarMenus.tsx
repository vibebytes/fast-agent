import type {ComponentType, ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {
	ContextMenuItem,
	ContextMenuSeparator
} from '@fast-ide/ui/components/context-menu';
import {
	DropdownMenuItem,
	DropdownMenuSeparator
} from '@fast-ide/ui/components/dropdown-menu';
import {
	Archive,
	Folder,
	FolderOpen,
	GitBranch,
	Pencil,
	Pin,
	Trash2,
	X
} from 'lucide-react';

type ItemProps = {
	variant?: 'default' | 'destructive';
	disabled?: boolean;
	onSelect?: () => void;
	children: ReactNode;
};

type SeparatorProps = {children?: never};

export type MenuChrome = {
	Item: ComponentType<ItemProps>;
	Separator: ComponentType<SeparatorProps>;
};

export const dropdownChrome: MenuChrome = {
	Item: ({onSelect, ...props}) => <DropdownMenuItem onClick={onSelect} {...props} />,
	Separator: () => <DropdownMenuSeparator />
};

export const contextChrome: MenuChrome = {
	Item: ({onSelect, ...props}) => <ContextMenuItem onSelect={onSelect} {...props} />,
	Separator: () => <ContextMenuSeparator />
};

export function ProjectMenuItems({
	menu,
	projectPinned,
	taskCount,
	onOpen,
	onPin,
	onShowInFolder,
	onRename,
	onArchiveAll,
	onRemove
}: {
	menu: MenuChrome;
	projectPinned: boolean;
	taskCount: number;
	onOpen: () => void;
	onPin: () => void;
	onShowInFolder: () => void;
	onRename: () => void;
	onArchiveAll: () => void;
	onRemove: () => void;
}) {
	const {t} = useTranslation();
	const {Item, Separator} = menu;
	return (
		<>
			<Item onSelect={onOpen}>
				<FolderOpen className="size-4" />
				{t('shell.sidebarMenu.open')}
			</Item>
			<Item onSelect={onPin}>
				<Pin className="size-4" />
				{projectPinned ? t('shell.sidebarMenu.unpinProject') : t('shell.sidebarMenu.pinProject')}
			</Item>
			<Item onSelect={onShowInFolder}>
				<Folder className="size-4" />
				{t('shell.sidebarMenu.revealInFinder')}
			</Item>
			<Item disabled>
				<GitBranch className="size-4" />
				{t('shell.sidebarMenu.createWorktree')}
			</Item>
			<Item onSelect={onRename}>
				<Pencil className="size-4" />
				{t('shell.sidebarMenu.rename')}
			</Item>
			<Item disabled={taskCount === 0} onSelect={onArchiveAll}>
				<Archive className="size-4" />
				{t('shell.sidebarMenu.archiveTasks')}
			</Item>
			<Separator />
			<Item variant="destructive" onSelect={onRemove}>
				<X className="size-4" />
				{t('shell.sidebarMenu.remove')}
			</Item>
		</>
	);
}

export function TaskMenuItems({
	menu,
	canMutate,
	pinned,
	onOpen,
	onRename,
	onShowInFolder,
	onPin,
	onArchive,
	onDelete
}: {
	menu: MenuChrome;
	canMutate: boolean;
	pinned: boolean;
	onOpen: () => void;
	onRename: () => void;
	onShowInFolder: () => void;
	onPin: () => void;
	onArchive: () => void;
	onDelete: () => void;
}) {
	const {t} = useTranslation();
	const {Item, Separator} = menu;
	return (
		<>
			<Item onSelect={onOpen}>
				<FolderOpen className="size-4" />
				{t('shell.sidebarMenu.open')}
			</Item>
			<Item disabled={!canMutate} onSelect={onRename}>
				<Pencil className="size-4" />
				{t('shell.sidebarMenu.rename')}
			</Item>
			<Item onSelect={onShowInFolder}>
				<Folder className="size-4" />
				{t('shell.sidebarMenu.revealInFinder')}
			</Item>
			<Item disabled={!canMutate} onSelect={onPin}>
				<Pin className="size-4" />
				{pinned ? t('shell.sidebarMenu.unpin') : t('shell.sidebarMenu.pin')}
			</Item>
			<Separator />
			<Item disabled={!canMutate} onSelect={onArchive}>
				<Archive className="size-4" />
				{t('shell.sidebarMenu.archive')}
			</Item>
			<Item variant="destructive" onSelect={onDelete}>
				<Trash2 className="size-4" />
				{t('shell.sidebarMenu.delete')}
			</Item>
		</>
	);
}
