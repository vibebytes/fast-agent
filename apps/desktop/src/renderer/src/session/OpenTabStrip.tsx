import {useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Button} from '@fast-ide/ui/components/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@fast-ide/ui/components/dropdown-menu';
import {useSidebar} from '@fast-ide/ui/components/sidebar';
import {cn} from '@fast-ide/ui/lib/utils';
import {ChevronDown, ChevronRight, Folder, PanelRight, X} from 'lucide-react';
import type {OpenTab, StripItem} from '../openSet';
import {
	flattenStripTabs,
	partitionStripOverflow,
	stripItemContainsTab,
	stripItemKey
} from '../openTabStripOverflow';
import {tabGroupTone} from '../tabGroupTone';

type TaskRunState = 'running' | 'completed-unseen';

function RunStateDot({runState}: {runState: TaskRunState}) {
	return (
		<span
			aria-hidden
			className={cn(
				'inline-block size-1.5 shrink-0 rounded-full',
				runState === 'running' && 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)] run-state-running',
				runState === 'completed-unseen' && 'bg-amber-500 shadow-[0_0_5px_rgba(245,158,11,0.5)]'
			)}
		/>
	);
}

function TabChip({
	tab,
	active,
	runState,
	onActivate,
	onClose,
	measure = false,
	/** When true, chip sits inside a tinted Tab Group shell. */
	inGroup = false
}: {
	tab: OpenTab;
	active: boolean;
	runState?: TaskRunState;
	onActivate: (tabId: string) => void;
	onClose: (tabId: string) => void;
	measure?: boolean;
	inGroup?: boolean;
}) {
	const displayTitle = tab.title.replace(/^\//, '');

	return (
		<div
			role={measure ? undefined : 'tab'}
			data-open-tab-id={measure ? undefined : tab.id}
			aria-selected={measure ? undefined : active}
			tabIndex={measure ? undefined : active ? 0 : -1}
			className={cn(
				'group relative flex cursor-pointer max-w-[13rem] min-w-[5.5rem] shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-all duration-150 select-none',
				// Group shell already has padding; inner chips sit 1px inset top/bottom vs bare strip h-7.
				inGroup ? 'h-[25px]' : 'h-7',
				active
					? 'bg-background text-foreground shadow-2xs border border-border/80 font-medium'
					: inGroup
						? 'bg-transparent text-muted-foreground/80 hover:bg-background/60 hover:text-foreground'
						: 'bg-transparent text-muted-foreground/90 hover:bg-muted/50 hover:text-foreground'
			)}
			onClick={measure ? undefined : () => onActivate(tab.id)}
			onKeyDown={
				measure
					? undefined
					: e => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								onActivate(tab.id);
							}
						}
			}
		>
			{runState ? (
				<RunStateDot runState={runState} />
			) : (
				<span className="inline-block size-1.5 shrink-0" />
			)}
			<span className="min-w-0 flex-1 truncate tracking-tight">{displayTitle}</span>
			{measure ? null : (
				<button
					type="button"
					className={cn(
						'inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 hover:text-foreground hover:bg-muted-foreground/15 active:scale-95 transition-all duration-150 ml-1',
						'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
						active && 'opacity-60 group-hover:opacity-100'
					)}
					aria-label={`Close ${tab.title}`}
					onClick={e => {
						e.stopPropagation();
						onClose(tab.id);
					}}
				>
					<X className="size-3" />
				</button>
			)}
		</div>
	);
}

function StripItemView({
	item,
	activeTabId,
	taskRunStates,
	groupLabels,
	onActivate,
	onClose,
	onToggleGroup,
	measure = false
}: {
	item: StripItem;
	activeTabId: string | null;
	taskRunStates: Record<string, TaskRunState>;
	groupLabels: Record<string, string>;
	onActivate: (tabId: string) => void;
	onClose: (tabId: string) => void;
	onToggleGroup: (groupKey: string) => void;
	measure?: boolean;
}) {
	if (item.type === 'tab') {
		return (
			<TabChip
				tab={item.tab}
				runState={taskRunStates[item.tab.id]}
				active={item.tab.id === activeTabId}
				onActivate={onActivate}
				onClose={onClose}
				measure={measure}
			/>
		);
	}
	const label = groupLabels[item.groupKey] ?? item.groupKey;
	const tone = tabGroupTone(item.groupKey);
	const visibleMembers = item.expanded
		? item.members
		: item.members.filter(t => t.id === activeTabId);
	return (
		<div
			role={measure ? undefined : 'group'}
			aria-label={measure ? undefined : `Tab Group ${label}`}
			className={cn(
				'group/grp flex shrink-0 items-center border transition-all duration-150 select-none',
				tone.shell,
				item.expanded
					? 'gap-0.5 rounded-lg p-0.5 shadow-2xs'
					: 'rounded-full px-1.5 py-0.5'
			)}
		>
			<button
				type="button"
				tabIndex={measure ? -1 : undefined}
				className={cn(
					'flex h-[25px] max-w-[8.5rem] shrink-0 items-center gap-1.5 px-2 text-[11px] font-medium transition-colors',
					tone.label,
					tone.labelHover,
					item.expanded ? 'rounded-md' : 'rounded-full'
				)}
				aria-expanded={measure ? undefined : item.expanded}
				aria-label={
					measure ? undefined : `${item.expanded ? 'Collapse' : 'Expand'} ${label}`
				}
				title={label}
				onClick={measure ? undefined : () => onToggleGroup(item.groupKey)}
			>
				<ChevronRight
					className={cn(
						'size-3 shrink-0 opacity-70 transition-transform duration-150',
						item.expanded && 'rotate-90'
					)}
				/>
				<span className="min-w-0 truncate tracking-tight font-mono">{label}</span>
			</button>
			{visibleMembers.map(tab => (
				<TabChip
					key={tab.id}
					tab={tab}
					runState={taskRunStates[tab.id]}
					active={tab.id === activeTabId}
					onActivate={onActivate}
					onClose={onClose}
					measure={measure}
					inGroup
				/>
			))}
		</div>
	);
}

/**
 * Middle-column Open Tab / Tab Group strip — replaces single-title TitleBar.
 * Overflowing chips fold into a right-side menu (no horizontal scrollbar).
 */
export function OpenTabStrip({
	items,
	activeTabId,
	taskRunStates,
	groupLabels,
	rightRailOpen,
	onActivate,
	onClose,
	onToggleGroup,
	onExpandRightRail
}: {
	items: StripItem[];
	activeTabId: string | null;
	taskRunStates: Record<string, TaskRunState>;
	groupLabels: Record<string, string>;
	rightRailOpen: boolean;
	onActivate: (tabId: string) => void;
	onClose: (tabId: string) => void;
	onToggleGroup: (groupKey: string) => void;
	onExpandRightRail: () => void;
}) {
	const {state} = useSidebar();
	const collapsed = state === 'collapsed';
	const hostRef = useRef<HTMLDivElement>(null);
	const measureRef = useRef<HTMLDivElement>(null);
	const [overflowIndexes, setOverflowIndexes] = useState<number[]>([]);
	// App owns the optimistic pressed highlight (covers sidebar clicks too);
	// this prop already carries it.
	const shownActiveId = activeTabId;

	useLayoutEffect(() => {
		const host = hostRef.current;
		const measure = measureRef.current;
		if (!host || !measure) return;

		const recompute = () => {
			const kids = Array.from(measure.children) as HTMLElement[];
			const widths = kids.map(el => el.getBoundingClientRect().width);
			const activeIndex = items.findIndex(item => stripItemContainsTab(item, shownActiveId));
			const next = partitionStripOverflow({
				widths,
				containerWidth: host.clientWidth,
				activeIndex
			});
			setOverflowIndexes(prev =>
				prev.length === next.overflowIndexes.length &&
				prev.every((v, i) => v === next.overflowIndexes[i])
					? prev
					: next.overflowIndexes
			);
		};

		recompute();
		const ro = new ResizeObserver(recompute);
		ro.observe(host);
		ro.observe(measure);
		return () => ro.disconnect();
	}, [items, shownActiveId, groupLabels, taskRunStates]);

	const overflowSet = useMemo(() => new Set(overflowIndexes), [overflowIndexes]);
	const visibleItems = items.filter((_, i) => !overflowSet.has(i));
	const overflowItems = overflowIndexes
		.map(i => items[i])
		.filter((item): item is StripItem => item != null);
	const overflowTabs = flattenStripTabs(overflowItems);

	return (
		<header className="flex h-10 shrink-0 items-stretch border-b border-border/60 bg-muted/20 select-none">
			{/* Offcanvas: sidebar gone — reserve lights + fixed SidebarTrigger over the inset. */}
			{collapsed ? (
				<div
					className={cn(
						'app-region-no-drag shrink-0',
						window.fastIde.platform === 'darwin' ? 'w-[108px]' : 'w-10'
					)}
					aria-hidden
				/>
			) : null}
			<div
				className={cn(
					'app-region-drag flex min-w-0 flex-1 items-center gap-1 overflow-x-hidden pl-3',
					// Match RightWorkbench header `px-1` when the expand control is visible.
					rightRailOpen ? 'pr-3' : 'pr-1'
				)}
			>
				<div
					ref={hostRef}
					className="app-region-no-drag relative flex h-8 min-w-0 flex-1 items-center overflow-x-hidden"
				>
					{/*
					 * Measure row clipped to 0×0 so intrinsic chip widths never expand
					 * the middle column's scrollWidth (absolute + wide flex caused the
					 * full-pane horizontal scrollbar).
					 */}
					<div
						aria-hidden
						className="pointer-events-none absolute top-0 left-0 h-0 w-0 overflow-hidden"
					>
						<div
							ref={measureRef}
							className="flex h-8 w-max flex-nowrap items-center gap-0.5 py-0.5"
						>
							{items.map(item => (
								<div key={`m:${stripItemKey(item)}`} className="shrink-0">
									<StripItemView
										item={item}
										activeTabId={shownActiveId}
										taskRunStates={taskRunStates}
										groupLabels={groupLabels}
										onActivate={onActivate}
										onClose={onClose}
										onToggleGroup={onToggleGroup}
										measure
									/>
								</div>
							))}
						</div>
					</div>

					<nav
						aria-label="Open Tabs"
						className="flex h-8 min-w-0 flex-1 flex-nowrap items-center gap-0.5 overflow-hidden py-0.5"
					>
						{visibleItems.map(item => (
							<StripItemView
								key={stripItemKey(item)}
								item={item}
								activeTabId={shownActiveId}
								taskRunStates={taskRunStates}
								groupLabels={groupLabels}
								onActivate={onActivate}
								onClose={onClose}
								onToggleGroup={onToggleGroup}
							/>
						))}
					</nav>

					{overflowTabs.length > 0 ? (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									className={cn(
										'app-region-no-drag ml-0.5 inline-flex h-5 shrink-0 items-center gap-0.5 rounded-md px-1.5',
										'border border-border/80 bg-background text-[11px] font-medium text-foreground/80 shadow-2xs',
										'hover:border-border hover:bg-muted hover:text-foreground transition-all duration-150',
										'outline-none focus-visible:ring-1 focus-visible:ring-ring',
										'data-[state=open]:border-border data-[state=open]:bg-muted data-[state=open]:text-foreground'
									)}
									aria-label={`${overflowTabs.length} more tabs`}
									title={`${overflowTabs.length} more tabs`}
								>
									<span className="tabular-nums leading-none">{overflowTabs.length}</span>
									<ChevronDown className="size-2.5 opacity-80" strokeWidth={2.5} />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="min-w-[12rem] max-w-[20rem]">
								{overflowTabs.map(tab => (
									<DropdownMenuItem
										key={tab.id}
										className="gap-2"
										onSelect={() => onActivate(tab.id)}
									>
										{taskRunStates[tab.id] ? (
											<RunStateDot runState={taskRunStates[tab.id]!} />
										) : (
											<span className="inline-block size-1.5 shrink-0" />
										)}
										<span className="min-w-0 flex-1 truncate">
											{tab.id === shownActiveId ? (
												<span className="font-medium">{tab.title}</span>
											) : (
												tab.title
											)}
										</span>
										<button
											type="button"
											className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
											aria-label={`Close ${tab.title}`}
											onPointerDown={e => e.preventDefault()}
											onClick={e => {
												e.preventDefault();
												e.stopPropagation();
												onClose(tab.id);
											}}
										>
											<X className="size-3" />
										</button>
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
				</div>
				{rightRailOpen ? null : (
					<div className="app-region-no-drag flex shrink-0 items-center">
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-7"
							aria-label="Expand right panel"
							title="Expand right panel"
							onClick={onExpandRightRail}
						>
							<PanelRight className="size-4" />
						</Button>
					</div>
				)}
			</div>
		</header>
	);
}
