import type {SurfaceOpen} from './surfaceEvents';

/**
 * Conversation → workbench hand-off for an explicit "open this" click. The card never talks to the
 * tab list: `RightWorkbench` owns it. While the rail is collapsed that component is unmounted, so a
 * request waits in a small backlog and is drained by the next mount — the same single delivery the
 * bridge replay gives `surface_open`, without turning the click into a second transport.
 */
type Handler = (open: SurfaceOpen) => void;

const railListeners = new Set<Handler>();
const tabListeners = new Set<Handler>();
let backlog: SurfaceOpen[] = [];

export function requestOpenSurface(open: SurfaceOpen): void {
	for (const fn of railListeners) fn(open);
	if (tabListeners.size > 0) {
		for (const fn of tabListeners) fn(open);
		return;
	}
	backlog = [...backlog.filter(o => o.extId !== open.extId || o.surfaceId !== open.surfaceId), open].slice(-8);
}

/** Rail expansion only; consumes nothing so the tab owner still sees the request on mount. */
export function onSurfaceOpenRequest(fn: Handler): () => void {
	railListeners.add(fn);
	return () => railListeners.delete(fn);
}

export function onSurfaceOpen(fn: Handler): () => void {
	tabListeners.add(fn);
	const drained = backlog;
	backlog = [];
	for (const open of drained) fn(open);
	return () => tabListeners.delete(fn);
}
