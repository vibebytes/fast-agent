import {useTranslation} from 'react-i18next';
import {useMemo} from 'react';
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut
} from '@fast-ide/ui/components/command';
import {
	Archive,
	Folder,
	MessageSquarePlus,
	Pin,
	Settings,
	SquarePen,
	Trash2,
	Users
} from 'lucide-react';
import type {ProjectSnapshot, TaskSummary} from './env';
import {basename} from './session/path';
import {archiveTask, forgetSessionChrome, togglePinTask} from './sidebarChrome';
import {loadSidebarUiState, saveSidebarUiState} from './sidebarUiState';
import type {TeamsTab} from './TeamsWorkbench';
import {openExistingFolder} from './openExistingFolder';
export type CommandPaletteProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projects: ProjectSnapshot[];
	projectTasks: Record<string, TaskSummary[]>;
	chats: TaskSummary[];
	activeTaskId: string | null;
	/** Ensure Open Tab + Focus Change (host owns open set). */
	onOpenTask: (taskId: string) => Promise<void>;
	/** Archive / delete — remove matching Open Tabs from the open set. */
	onDropOpenTabs: (taskIds: string[]) => void;
	onOpenTeams?: (req: {tab?: TeamsTab; goalId?: string; teamId?: string; agentId?: string}) => void;
};

type TaskEntry = {
	id: string;
	title: string;
	projectId: string | null;
	projectPath: string | null;
	projectName: string | null;
	sessionId: string | null;
	kind: 'task' | 'chat';
};

function isMacPlatform(): boolean {
	return /Mac|iPhone|iPad/.test(navigator.platform) || navigator.userAgent.includes('Mac');
}

function modKey(): string {
	return isMacPlatform() ? '⌘' : 'Ctrl+';
}

function altKey(): string {
	return isMacPlatform() ? '⌥' : 'Alt+';
}

function shiftKey(): string {
	return isMacPlatform() ? '⇧' : 'Shift+';
}

export function CommandPalette({
	open,
	onOpenChange,
	projects,
	projectTasks,
	chats,
	activeTaskId,
	onOpenTask,
	onDropOpenTabs,
	onOpenTeams
}: CommandPaletteProps) {
	const {t} = useTranslation();
	const mod = modKey();
	const alt = altKey();
	const shift = shiftKey();

	const entries = useMemo(() => {
		const list: TaskEntry[] = [];
		for (const project of projects) {
			for (const task of projectTasks[project.id] ?? []) {
				list.push({
					id: task.id,
					title: task.title || 'Untitled',
					projectId: project.id,
					projectPath: project.path,
					projectName: project.displayName?.trim() || basename(project.path),
					sessionId: task.sessionId ?? null,
					kind: 'task'
				});
			}
		}
		for (const chat of chats) {
			list.push({
				id: chat.id,
				title: chat.title || 'Untitled',
				projectId: null,
				projectPath: null,
				projectName: null,
				sessionId: chat.sessionId ?? null,
				kind: 'chat'
			});
		}
		return list;
	}, [projects, projectTasks, chats]);

	function close() {
		onOpenChange(false);
	}

	async function openTask(entry: TaskEntry) {
		close();
		await onOpenTask(entry.id);
	}

	async function runNewTask() {
		close();
		// Top-level New task always targets the hidden Default Project.
		await window.fastIde.createTask('New task');
	}

	async function runOpenFolder() {
		close();
		await openExistingFolder();
	}

	async function runNewChat() {
		close();
		await window.fastIde.createChat('New chat');
	}

	async function runNewProjectlessTask() {
		close();
		await window.fastIde.createTask('New task');
	}

	function activeEntry(): TaskEntry | null {
		return entries.find(e => e.id === activeTaskId) ?? null;
	}

	function runArchiveActive() {
		const entry = activeEntry();
		if (!entry?.projectPath || !entry.sessionId) return;
		const ui = loadSidebarUiState();
		saveSidebarUiState(archiveTask(ui, entry.projectPath, entry.sessionId));
		onDropOpenTabs([entry.id]);
		close();
	}

	async function runDeleteActive() {
		const entry = activeEntry();
		if (!entry) return;
		const ok = window.confirm(
			t('shell.palette.deleteConfirm', {title: entry.title})
		);
		if (!ok) return;
		close();
		const result = await window.fastIde.deleteTask(entry.id, entry.sessionId);
		if (!result.ok) {
			if (result.notice) console.error('[deleteTask]', result.notice);
			return;
		}
		if (entry.projectPath && entry.sessionId) {
			const ui = loadSidebarUiState();
			saveSidebarUiState(forgetSessionChrome(ui, entry.projectPath, entry.sessionId));
		}
		onDropOpenTabs([entry.id]);
	}

	function runTogglePinActive() {
		const entry = activeEntry();
		if (!entry?.projectPath || !entry.sessionId) return;
		const ui = loadSidebarUiState();
		saveSidebarUiState(togglePinTask(ui, entry.projectPath, entry.sessionId, entry.title));
		close();
	}

	const canArchiveOrPin = Boolean(activeEntry()?.projectPath && activeEntry()?.sessionId);
	const canDelete = Boolean(activeEntry());

	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			title={t('shell.palette.title')}
			description={t('shell.palette.description')}
			showCloseButton={false}
			className="sm:max-w-xl"
		>
			<CommandInput placeholder={t('shell.palette.placeholder')} />
			<div className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">{t('shell.palette.title')}</div>
			<CommandList className="max-h-[min(420px,60vh)]">
				<CommandEmpty>{t('shell.palette.empty')}</CommandEmpty>

				{entries.length > 0 ? (
					<CommandGroup heading={t('shell.palette.groupTasks')}>
						{entries.map((entry, index) => (
							<CommandItem
								key={`${entry.kind}:${entry.id}`}
								value={`task ${entry.title} ${entry.projectName ?? ''} ${entry.id}`}
								onSelect={() => void openTask(entry)}
							>
								<span className="min-w-0 flex-1 truncate">{entry.title}</span>
								{entry.projectName ? (
									<span className="shrink-0 text-xs text-muted-foreground">
										{entry.projectName}
									</span>
								) : null}
								{index < 9 ? (
									<CommandShortcut>
										{mod}
										{index + 1}
									</CommandShortcut>
								) : null}
							</CommandItem>
						))}
					</CommandGroup>
				) : null}

				<CommandGroup heading={t('shell.palette.groupRecommended')}>
					<CommandItem value="new task" onSelect={() => void runNewTask()}>
						<SquarePen />
						<span>{t('shell.palette.newTask')}</span>
						<CommandShortcut>{mod}N</CommandShortcut>
					</CommandItem>
					<CommandItem value="open folder" onSelect={() => void runOpenFolder()}>
						<Folder />
						<span>{t('shell.palette.openFolder')}</span>
						<CommandShortcut>{mod}O</CommandShortcut>
					</CommandItem>
					{onOpenTeams ? (
						<>
							<CommandItem
								value="Teams Open goals"
								onSelect={() => {
									close();
									onOpenTeams({tab: 'goals'});
								}}
							>
								<Users />
								<span>{t('shell.palette.openTeamsGoals')}</span>
							</CommandItem>
							<CommandItem
								value="Teams Open teams"
								onSelect={() => {
									close();
									onOpenTeams({tab: 'teams'});
								}}
							>
								<Users />
								<span>{t('shell.palette.openTeamsTeams')}</span>
							</CommandItem>
							<CommandItem
								value="Teams Open agents"
								onSelect={() => {
									close();
									onOpenTeams({tab: 'agents'});
								}}
							>
								<Users />
								<span>{t('shell.palette.openTeamsAgents')}</span>
							</CommandItem>
						</>
					) : null}
					<CommandItem value="settings" disabled>
						<Settings />
						<span>{t('shell.palette.settings')}</span>
						<CommandShortcut>{mod},</CommandShortcut>
					</CommandItem>
				</CommandGroup>

				<CommandGroup heading={t('shell.palette.groupTasks')}>
					<CommandItem
						value="new orphan task"
						onSelect={() => void runNewProjectlessTask()}
					>
						<SquarePen />
						<span>{t('shell.palette.newOrphanTask')}</span>
						<CommandShortcut>
							{alt}
							{mod}O
						</CommandShortcut>
					</CommandItem>
					<CommandItem value="new chat" onSelect={() => void runNewChat()}>
						<MessageSquarePlus />
						<span>{t('shell.palette.newChat')}</span>
						<CommandShortcut>
							{alt}
							{mod}N
						</CommandShortcut>
					</CommandItem>
					<CommandItem
						value="archive task"
						disabled={!canArchiveOrPin}
						onSelect={runArchiveActive}
					>
						<Archive />
						<span>{t('shell.palette.archiveTask')}</span>
						<CommandShortcut>
							{shift}
							{mod}A
						</CommandShortcut>
					</CommandItem>
					<CommandItem
						value="delete task"
						disabled={!canDelete}
						onSelect={() => void runDeleteActive()}
					>
						<Trash2 />
						<span>{t('shell.palette.deleteTask')}</span>
					</CommandItem>
					<CommandItem
						value="toggle pin"
						disabled={!canArchiveOrPin}
						onSelect={runTogglePinActive}
					>
						<Pin />
						<span>{t('shell.palette.togglePin')}</span>
						<CommandShortcut>
							{alt}
							{mod}P
						</CommandShortcut>
					</CommandItem>
				</CommandGroup>
			</CommandList>
		</CommandDialog>
	);
}

export {useCommandPaletteShortcut} from './commandPaletteShortcut';
