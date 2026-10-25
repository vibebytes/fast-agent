import type {SurfaceState} from '@fastllm/bridge-client';

export type SurfaceOpen = {
	extId: string;
	surfaceId: string;
	url: string;
	instanceKey?: string;
	roomId?: string;
	title?: string;
};

export type SurfaceStateEvent = {
	extId: string;
	surfaceId: string;
	state: SurfaceState;
	detail?: string;
};

const STATES: readonly SurfaceState[] = ['unknown', 'ready', 'down', 'error'];

function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function httpUrl(value: unknown): string | undefined {
	const url = str(value);
	if (!url || !/^https?:\/\//i.test(url)) return undefined;
	try {
		new URL(url);
		return url;
	} catch {
		return undefined;
	}
}

/** Host-side bridge event `surface_open` (the bridge turns `ext.<extId>.surface.open` into it). */
export function parseSurfaceOpen(event: unknown): SurfaceOpen | null {
	if (!event || typeof event !== 'object') return null;
	const e = event as Record<string, unknown>;
	if (e.type !== 'surface_open') return null;
	const extId = str(e.extId);
	const surfaceId = str(e.surfaceId);
	const url = httpUrl(e.url);
	if (!extId || !surfaceId || !url) return null;
	return {
		extId,
		surfaceId,
		url,
		instanceKey: str(e.instanceKey),
		roomId: str(e.roomId),
		title: str(e.title)
	};
}

export function parseSurfaceState(event: unknown): SurfaceStateEvent | null {
	if (!event || typeof event !== 'object') return null;
	const e = event as Record<string, unknown>;
	if (e.type !== 'surface_state') return null;
	const extId = str(e.extId);
	const surfaceId = str(e.surfaceId);
	const state = STATES.find(s => s === e.state);
	if (!extId || !surfaceId || !state) return null;
	return {extId, surfaceId, state, detail: str(e.detail)};
}

/**
 * The extension list is the menu/hint source; refresh it only when the set of extensions changes.
 * `surface_open` / `surface_state` must NOT trigger a reload: ListExtensions replays those very
 * events, so echoing them back turns the host into an infinite open↔replay ping-pong.
 */
export function surfacesReloadOn(type: string | undefined): boolean {
	return type === 'extensions_changed';
}
