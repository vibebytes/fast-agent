import type {SurfaceCapability} from '@fastllm/bridge-client';

export type HostMsg =
	| {
			kind: 'host.ready';
			surfaceId: string;
			instanceKey: string;
			theme: 'dark' | 'light';
			size: {width: number; height: number};
	  }
	| {kind: 'host.token'; token: string; toolScope: string[]};

export type PageMsg =
	| {kind: 'surface.ready'; capabilities: SurfaceCapability[]}
	| {kind: 'surface.openExternal'; url: string}
	| {kind: 'surface.size'; width: number; height: number};

const CAPABILITIES: readonly SurfaceCapability[] = ['tool.call', 'clipboard', 'open-external'];

/** iframe `allow` attribute: webgl/fullscreen always, clipboard only when declared. */
export function allowFrom(caps: readonly SurfaceCapability[]): string {
	const parts = ['webgl', 'fullscreen'];
	if (caps.includes('clipboard')) parts.push('clipboard-write');
	return parts.join('; ');
}

/** No `allow-same-origin`: a surface must never share the host origin. */
export function surfaceSandbox(): string {
	return 'allow-scripts allow-forms allow-popups';
}

function isCapability(value: unknown): value is SurfaceCapability {
	return typeof value === 'string' && (CAPABILITIES as readonly string[]).includes(value);
}

function isSize(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Parse a message from the panel; anything off-origin or off-shape is dropped silently. */
export function readPageMsg(data: unknown, origin: string, expectedOrigin: string): PageMsg | null {
	if (origin !== expectedOrigin) return null;
	if (!data || typeof data !== 'object') return null;
	const msg = data as {kind?: unknown; capabilities?: unknown; url?: unknown; width?: unknown; height?: unknown};
	switch (msg.kind) {
		case 'surface.ready': {
			const caps = msg.capabilities;
			if (!Array.isArray(caps) || !caps.every(isCapability)) return null;
			return {kind: 'surface.ready', capabilities: caps};
		}
		case 'surface.openExternal':
			return typeof msg.url === 'string' ? {kind: 'surface.openExternal', url: msg.url} : null;
		case 'surface.size':
			return isSize(msg.width) && isSize(msg.height)
				? {kind: 'surface.size', width: msg.width, height: msg.height}
				: null;
		default:
			return null;
	}
}

export function readyAccepted(requested: readonly SurfaceCapability[], declared: readonly SurfaceCapability[]): boolean {
	return requested.every(cap => declared.includes(cap));
}

export function hostReady(input: {
	surfaceId: string;
	instanceKey: string;
	theme: 'dark' | 'light';
	width: number;
	height: number;
}): HostMsg {
	return {
		kind: 'host.ready',
		surfaceId: input.surfaceId,
		instanceKey: input.instanceKey,
		theme: input.theme,
		size: {width: input.width, height: input.height}
	};
}

export function hostToken(token: string, toolScope: string[]): HostMsg {
	return {kind: 'host.token', token, toolScope};
}

export type {SurfaceCapability};
