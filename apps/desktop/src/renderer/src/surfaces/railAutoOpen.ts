import {surfaceCloseKey, type SurfaceOpenIntent} from './surfaceTabs';

/**
 * While the right rail is collapsed, RightWorkbench is unmounted and its surface_open
 * subscription is gone, so App watches the bridge itself. The first open of an instance
 * expands the rail; replays of an instance App has already seen (ListExtensions echoes it
 * on every call) must not reopen a rail the user deliberately collapsed — same no-resurrection
 * contract as the tabs inside RightWorkbench.
 */
export function railOpenIntent(seen: Set<string>, open: SurfaceOpenIntent): boolean {
	const key = surfaceCloseKey(open);
	if (seen.has(key)) return false;
	seen.add(key);
	return true;
}
