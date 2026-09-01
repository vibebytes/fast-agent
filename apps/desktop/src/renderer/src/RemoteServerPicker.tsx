import {shellT as t} from './i18n/t';
import {useState} from 'react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@fast-ide/ui/components/dropdown-menu';
import {cn} from '@fast-ide/ui/lib/utils';
import {Check, ChevronDown, HardDrive, Loader2, Monitor} from 'lucide-react';
import type {EdgesList} from '@fast-ide/session-view';

/**
 * Sidebar-top server switcher — same behavior as the 远程服务器 submenu in the
 * bottom-left system menu (confirm while a run is active, alert on failure).
 */
export function RemoteServerPicker({edges}: {edges: EdgesList | null}) {
	const [open, setOpen] = useState(false);

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

	const activeId = edges?.activeId ?? 'local';
	const activeName =
		activeId === 'local'
			? t('shell.sidebar.localEdge')
			: (edges?.servers.find(row => row.id === activeId)?.name ??
				t('shell.sidebar.localEdge'));
	const connecting = Boolean(edges?.pendingEdgeId);

	const rows = [
		{id: 'local', name: t('shell.sidebar.localEdge'), local: true},
		...(edges?.servers ?? []).map(row => ({id: row.id, name: row.name, local: false}))
	];

	return (
		<div className="px-2 pt-1 pb-0.5">
			<DropdownMenu open={open} onOpenChange={setOpen}>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						className={cn(
							'group/server flex h-8 w-full min-w-0 items-center gap-2 rounded-md border px-2 text-left',
							'border-sidebar-border/70 bg-sidebar-accent/40 text-xs text-sidebar-foreground',
							'transition-colors outline-none hover:border-sidebar-border hover:bg-sidebar-accent',
							'data-[state=open]:border-sidebar-border data-[state=open]:bg-sidebar-accent',
							'focus-visible:ring-2 focus-visible:ring-sidebar-ring'
						)}
						aria-label={t('shell.sidebar.remoteServers')}
					>
						<span
							className={cn(
								'flex size-5 shrink-0 items-center justify-center rounded-[5px]',
								'bg-violet-500/15 text-violet-500'
							)}
						>
							{connecting ? (
								<Loader2 className="size-3 animate-spin" />
							) : activeId === 'local' ? (
								<Monitor className="size-3" />
							) : (
								<HardDrive className="size-3" />
							)}
						</span>
						<span className="min-w-0 flex-1 truncate font-medium" title={activeName}>
							{activeName}
						</span>
						{connecting ? (
							<span className="shrink-0 text-[10px] text-sidebar-muted-foreground">
								{t('shell.sidebar.connecting')}
							</span>
						) : (
							<span
								aria-hidden
								className="size-1.5 shrink-0 rounded-full bg-emerald-500"
							/>
						)}
						<ChevronDown
							className={cn(
								'size-3.5 shrink-0 text-sidebar-muted-foreground transition-transform',
								open && 'rotate-180'
							)}
						/>
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					side="bottom"
					align="start"
					className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-48 [&_[data-slot=dropdown-menu-item]]:cursor-pointer"
				>
					<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
						{t('shell.sidebar.remoteServers')}
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					{rows.map(row => {
						const isActive = row.id === activeId;
						const isPending = edges?.pendingEdgeId === row.id;
						return (
							<DropdownMenuItem
								key={row.id}
								className="gap-2"
								onSelect={() => void selectEdge(row.id)}
							>
								{row.local ? (
									<Monitor className="size-4 text-muted-foreground" />
								) : (
									<HardDrive className="size-4 text-muted-foreground" />
								)}
								<span className="min-w-0 flex-1 truncate">{row.name}</span>
								{isPending ? (
									<span className="shrink-0 text-xs text-muted-foreground">
										{t('shell.sidebar.connecting')}
									</span>
								) : isActive ? (
									<Check className="size-4 shrink-0 text-emerald-500" />
								) : null}
							</DropdownMenuItem>
						);
					})}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
