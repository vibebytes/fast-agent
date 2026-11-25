import type {ReactNode} from 'react';
import {ContextMenuItem, ContextMenuSeparator} from '@fast-ide/ui/components/context-menu';
import {Copy, FilePlus2, FolderPlus, FileText, FolderSymlink, Trash2} from 'lucide-react';
import {shellT as t} from '../i18n/t';
import {joinWorkspacePath} from '../session/path';

export function FilePathMenuItems({
	relativePath,
	projectPath,
	onOpen,
	openDisabled,
	openIcon = <FileText className="size-3.5" />,
	onNewFile,
	onNewFolder,
	onDelete,
	isDir = false
}: {
	relativePath: string;
	projectPath: string | null;
	onOpen: () => void;
	openDisabled?: boolean;
	openIcon?: ReactNode;
	onNewFile?: () => void;
	onNewFolder?: () => void;
	onDelete?: () => void;
	isDir?: boolean;
}) {
	return (
		<>
			<ContextMenuItem disabled={openDisabled} onSelect={onOpen}>
				{openIcon}
				{t('shell.filesMenu.open')}
			</ContextMenuItem>
			{onNewFile ? (
				<ContextMenuItem onSelect={onNewFile}>
					<FilePlus2 className="size-3.5" />
					{t('shell.filesMenu.newFile')}
				</ContextMenuItem>
			) : null}
			{onNewFolder ? (
				<ContextMenuItem onSelect={onNewFolder}>
					<FolderPlus className="size-3.5" />
					{t('shell.filesMenu.newFolder')}
				</ContextMenuItem>
			) : null}
			<ContextMenuItem onSelect={() => void window.fastIde.showWorkspacePathInFolder(relativePath)}>
				<FolderSymlink className="size-3.5" />
				{t('shell.filesMenu.revealInFolder')}
			</ContextMenuItem>
			<ContextMenuItem onSelect={() => void navigator.clipboard.writeText(relativePath)}>
				<Copy className="size-3.5" />
				{t('shell.filesMenu.copyRelativePath')}
			</ContextMenuItem>
			<ContextMenuItem
				disabled={!projectPath}
				onSelect={() => {
					if (projectPath)
						void navigator.clipboard.writeText(joinWorkspacePath(projectPath, relativePath));
				}}
			>
				<Copy className="size-3.5" />
				{t('shell.filesMenu.copyAbsolutePath')}
			</ContextMenuItem>
			{onDelete ? (
				<>
					<ContextMenuSeparator />
					<ContextMenuItem variant="destructive" onSelect={onDelete}>
						<Trash2 className="size-3.5" />
						{t(isDir ? 'shell.filesMenu.deleteDirectory' : 'shell.filesMenu.deleteFile')}
					</ContextMenuItem>
				</>
			) : null}
		</>
	);
}
