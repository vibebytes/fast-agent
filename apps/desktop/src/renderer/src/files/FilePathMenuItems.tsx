import type {ReactNode} from 'react';
import {ContextMenuItem} from '@fast-ide/ui/components/context-menu';
import {Copy, FileText, FolderSymlink} from 'lucide-react';
import {shellT as t} from '../i18n/t';
import {joinWorkspacePath} from '../session/path';

/**
 * The four file-path actions (open / reveal / copy paths) shared by the Files tree and the review
 * rows, so labels, icons and disabled states cannot drift between the two menus.
 */
export function FilePathMenuItems({
	relativePath,
	projectPath,
	onOpen,
	openDisabled,
	openIcon = <FileText className="size-3.5" />
}: {
	relativePath: string;
	/** Project root — null grays out "Copy Absolute Path" instead of copying a wrong path. */
	projectPath: string | null;
	onOpen: () => void;
	openDisabled?: boolean;
	openIcon?: ReactNode;
}) {
	return (
		<>
			<ContextMenuItem disabled={openDisabled} onSelect={onOpen}>
				{openIcon}
				{t('shell.filesMenu.open')}
			</ContextMenuItem>
			<ContextMenuItem
				onSelect={() => void window.fastIde.showWorkspacePathInFolder(relativePath)}
			>
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
		</>
	);
}
