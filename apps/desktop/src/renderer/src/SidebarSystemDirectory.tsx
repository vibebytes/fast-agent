import {useTranslation} from 'react-i18next';
import {LOCALE_NATIVE_NAME, SUPPORTED, type LocalePref} from '@fast-ide/i18n';
import {Avatar, AvatarFallback} from '@fast-ide/ui/components/avatar';
import {Button} from '@fast-ide/ui/components/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger
} from '@fast-ide/ui/components/dropdown-menu';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	Check,
	CircleHelp,
	Egg,
	HardDrive,
	Info,
	Languages,
	LogOut,
	Palette,
	Settings
} from 'lucide-react';
import {useEffect, useState, type ReactNode} from 'react';
import type {EdgesList} from '@fast-ide/session-view';

/** Flip to show the pet toggle again. */
const SHOW_PET_MENU = false;

function initialsFromName(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return 'FI';
	if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
	return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

export type SidebarSystemDirectoryProps = {
	displayName?: string;
	/** Theme picker shown in the Theme submenu. */
	themeContent?: ReactNode;
	localePref?: LocalePref;
	onLocaleChange?: (pref: LocalePref) => void;
	onOpenSettings2?: () => void;
	edges?: EdgesList | null;
	className?: string;
};

/**
 * Codex / Claude-style system account strip at the bottom of the sidebar.
 */
export function SidebarSystemDirectory({
	displayName = 'Local User',
	themeContent,
	localePref,
	onLocaleChange,
	onOpenSettings2,
	edges,
	className
}: SidebarSystemDirectoryProps) {
	const {t} = useTranslation();
	const initials = initialsFromName(displayName);
	const [petVisible, setPetVisibleState] = useState(false);

	useEffect(() => {
		if (!SHOW_PET_MENU) return;
		void window.fastIde.getPetVisible().then(setPetVisibleState);
	}, []);

	async function togglePet() {
		const next = !petVisible;
		const applied = await window.fastIde.setPetVisible(next);
		setPetVisibleState(applied);
	}

	async function selectEdge(id: string) {
		if (edges?.runActive && !window.confirm(t('shell.sidebar.switchEdgeConfirm'))) return;
		const res = await window.fastIde.selectEdge(id);
		if (!res.ok && res.code !== 'aborted') {
			window.alert(
				res.code === 'unpinned'
					? t('settings.pages.servers.pinRequired')
					: res.code === 'plaintext'
						? t('settings.pages.servers.tlsPlaintext')
						: t('shell.sidebar.switchEdgeFailed', {code: res.code, message: res.message})
			);
		}
	}
	return (
		<div className={cn('w-full border-t border-sidebar-border/60 bg-sidebar/50', className)}>
			<DropdownMenu>
				{/*
				  Hover must paint the full footer cell (edge-to-edge under the separator),
				  not an inset rounded chip — otherwise it reads as a floating pill.
				*/}
				<div
					className={cn(
						'group/system flex h-10 w-full items-center gap-0.5 px-3',
						'hover:bg-sidebar-accent',
						'has-[[data-state=open]]:bg-sidebar-accent'
					)}
				>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							className={cn(
								'flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2',
								'text-left text-sm text-sidebar-foreground',
								'outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0'
							)}
							aria-label={t('shell.sidebar.systemDirectory')}
						>
							<Avatar size="sm" className="size-6">
								<AvatarFallback className="bg-violet-500 text-[10px] font-medium text-white">
									{initials}
								</AvatarFallback>
							</Avatar>
							<span className="min-w-0 flex-1 truncate font-medium">{displayName}</span>
						</button>
					</DropdownMenuTrigger>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-7 shrink-0 text-sidebar-muted-foreground hover:bg-transparent hover:text-sidebar-accent-foreground"
						aria-label={t('shell.sidebar.getHelp')}
						title={t('shell.sidebar.getHelp')}
						onClick={e => {
							e.stopPropagation();
							void window.open('https://github.com/', '_blank');
						}}
					>
						<CircleHelp className="size-4" />
					</Button>
				</div>
				<DropdownMenuContent
					side="top"
					align="start"
					sideOffset={8}
					className="w-56 [&_[data-slot=dropdown-menu-item]]:cursor-pointer [&_[data-slot=dropdown-menu-sub-trigger]]:cursor-pointer"
				>
						<DropdownMenuLabel className="flex items-center gap-2 p-2 font-normal">
							<Avatar size="sm" className="size-7">
								<AvatarFallback className="bg-violet-500 text-[11px] font-medium text-white">
									{initials}
								</AvatarFallback>
							</Avatar>
							<span className="truncate text-sm font-medium text-foreground">
								{displayName}
							</span>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						{localePref != null && onLocaleChange ? (
							<DropdownMenuSub>
								<DropdownMenuSubTrigger className="gap-2">
									<Languages className="size-4" />
									<span>{t('shell.sidebar.language')}</span>
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="w-56">
									<DropdownMenuRadioGroup
										value={localePref}
										onValueChange={value => onLocaleChange(value as LocalePref)}
									>
										<DropdownMenuRadioItem value="system">
											{t('settings.languageSystem')}
										</DropdownMenuRadioItem>
										{SUPPORTED.map(code => (
											<DropdownMenuRadioItem key={code} value={code}>
												{LOCALE_NATIVE_NAME[code]}
											</DropdownMenuRadioItem>
										))}
									</DropdownMenuRadioGroup>
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						) : null}
						{SHOW_PET_MENU ? (
							<DropdownMenuItem className="gap-2" onSelect={() => void togglePet()}>
								<Egg className="size-4" />
								<span>{petVisible ? t('shell.sidebar.hidePet') : t('shell.sidebar.showPet')}</span>
							</DropdownMenuItem>
						) : null}
						<DropdownMenuSub>
							<DropdownMenuSubTrigger className="gap-2">
								<HardDrive className="size-4" />
								<span>{t('shell.sidebar.remoteServers')}</span>
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent className="w-56">
								<DropdownMenuItem
									className="gap-2"
									onSelect={() => void selectEdge('local')}
								>
									{edges?.activeId === 'local' ? <Check className="size-4" /> : <span className="size-4" />}
									<span className="flex-1">{t('shell.sidebar.localEdge')}</span>
									{edges?.pendingEdgeId === 'local' ? (
										<span className="text-xs text-muted-foreground">
											{t('shell.sidebar.connecting')}
										</span>
									) : null}
								</DropdownMenuItem>
								{(edges?.servers ?? []).map(row => (
									<DropdownMenuItem
										key={row.id}
										className="gap-2"
										onSelect={() => void selectEdge(row.id)}
									>
										{edges?.activeId === row.id ? (
											<Check className="size-4" />
										) : (
											<span className="size-4" />
										)}
										<span className="flex-1 truncate">{row.name}</span>
										{edges?.pendingEdgeId === row.id ? (
											<span className="text-xs text-muted-foreground">
												{t('shell.sidebar.connecting')}
											</span>
										) : null}
									</DropdownMenuItem>
								))}
							</DropdownMenuSubContent>
						</DropdownMenuSub>
						{onOpenSettings2 ? (
							<DropdownMenuItem className="gap-2" onSelect={onOpenSettings2}>
								<Settings className="size-4" />
								<span className="flex-1">{t('shell.sidebar.settings')}</span>
							</DropdownMenuItem>
						) : null}
						{themeContent ? (
							<DropdownMenuSub>
								<DropdownMenuSubTrigger className="gap-2">
									<Palette className="size-4" />
									<span>{t('shell.sidebar.theme')}</span>
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="w-56 p-2">
									{themeContent}
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						) : null}
						<DropdownMenuItem
							className="gap-2"
							onSelect={() => {
								void window.open('https://github.com/', '_blank');
							}}
						>
							<CircleHelp className="size-4" />
							<span>{t('shell.sidebar.getHelp')}</span>
						</DropdownMenuItem>
						<DropdownMenuItem disabled className="gap-2">
							<Info className="size-4" />
							<span>{t('shell.sidebar.about')}</span>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem disabled className="gap-2">
							<LogOut className="size-4" />
							<span>{t('shell.sidebar.signOut')}</span>
						</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
