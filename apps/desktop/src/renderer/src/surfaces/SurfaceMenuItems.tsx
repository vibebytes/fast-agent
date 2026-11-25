import {CommandItem} from '@fast-ide/ui/components/command';
import {Boxes} from 'lucide-react';
import {availableSurfaceList, surfaceTabId, type SurfaceOpenIntent} from './surfaceTabs';

/** The surface section of the rail's "+" menu: declared/open surfaces the user can add as tabs. */
export function SurfaceMenuItems({
	available,
	onSelect
}: {
	available: ReadonlyMap<string, SurfaceOpenIntent>;
	onSelect: (open: SurfaceOpenIntent) => void;
}) {
	return availableSurfaceList(available).map(open => (
		<CommandItem
			key={surfaceTabId(open.extId, open.surfaceId)}
			value={open.title ?? open.surfaceId}
			onSelect={() => onSelect(open)}
		>
			<Boxes className="size-4 text-muted-foreground" />
			<span className="flex-1">{open.title ?? open.surfaceId}</span>
		</CommandItem>
	));
}
