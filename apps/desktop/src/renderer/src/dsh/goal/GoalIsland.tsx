import {Button} from '@fast-ide/ui/components/button';
import type {DshCaps, DshGoalView} from '../../env';

export function GoalIsland({
	caps,
	goal
}: {
	caps?: DshCaps;
	goal?: DshGoalView | null;
}) {
	if (!caps?.goal || !goal) return null;
	const paused = goal.phase === 'paused';
	return (
		<div className="flex items-center gap-2 px-3 py-2 text-xs">
			<div className="min-w-0 flex-1">
				<div className="truncate font-medium">{goal.title || 'Goal'}</div>
				{goal.text ? <div className="truncate text-muted-foreground">{goal.text}</div> : null}
			</div>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="h-7 px-2"
				onClick={() => void window.fastIde.dshGoalAct(paused ? 'resume' : 'pause')}
			>
				{paused ? 'Resume' : 'Pause'}
			</Button>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="h-7 px-2"
				onClick={() => void window.fastIde.dshGoalAct('complete')}
			>
				Done
			</Button>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="h-7 px-2"
				onClick={() => void window.fastIde.dshGoalAct('clear')}
			>
				Clear
			</Button>
		</div>
	);
}
