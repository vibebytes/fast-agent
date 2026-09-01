import {Button} from '@fast-ide/ui/components/button';
import {useSidebar} from '@fast-ide/ui/components/sidebar';
import {cn} from '@fast-ide/ui/lib/utils';
import {PanelRight, RotateCcw} from 'lucide-react';

export function ChatTitleBar({
	title,
	engineReady,
	rightRailOpen,
	onNewTask,
	onToggleRightRail
}: {
	title: string;
	engineReady: boolean;
	rightRailOpen: boolean;
	onNewTask: () => void;
	onToggleRightRail: () => void;
}) {
	const {state} = useSidebar();
	const collapsed = state === 'collapsed';
	return (
		<header className="flex h-10 shrink-0 items-stretch border-b">
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
			<div className="app-region-drag flex min-w-0 flex-1 items-center gap-2 pr-3 pl-3">
				<h1 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">{title}</h1>
				<div className="app-region-no-drag flex shrink-0 items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-7"
						disabled={!engineReady}
						aria-label="New task"
						onClick={onNewTask}
					>
						<RotateCcw className="size-3.5" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="hidden size-7 md:inline-flex"
						aria-label={rightRailOpen ? 'Collapse right panel' : 'Expand right panel'}
						title={rightRailOpen ? 'Collapse right panel' : 'Expand right panel'}
						onClick={onToggleRightRail}
					>
						<PanelRight className="size-3.5" />
					</Button>
				</div>
			</div>
		</header>
	);
}

