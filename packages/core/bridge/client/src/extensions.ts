export type ExtPhase = 'Installed' | 'Active' | 'Stopping' | 'Uninstalled' | 'Failed';

export type SurfaceSlot = 'pane';
export type SurfaceKind = 'web' | 'mcp-app';
export type SurfaceCapability = 'tool.call' | 'clipboard' | 'open-external';
export type SurfaceState = 'unknown' | 'ready' | 'down' | 'error';

/** Declared UI surface. Carries no url/resourceUri — the host resolves those per instance. */
export type SurfaceWire = {
	id: string;
	title: string;
	slot: SurfaceSlot;
	kind: SurfaceKind;
	icon?: string;
	capabilities: SurfaceCapability[];
	order: number;
	singleton: boolean;
	state: SurfaceState;
};

export type ExtRow = {
	id: string;
	phase: ExtPhase;
	hotUnload: boolean;
	fault?: string;
	restartHint?: string;
	provides?: {surfaces?: SurfaceWire[]};
};

/** Local Ledger trail mark from ListExtensions (`put` / `drop`). */
export type ExtNote = {
	id: string;
	mark: string;
};

export type ExtOk<T> = {ok: true} & T;
export type ExtErr = {ok: false; notice: string};

export type ExtAdminApi = {
	listExtensions: () => Promise<ExtOk<{extensions: ExtRow[]; ledger: ExtNote[]}> | ExtErr>;
	extensionStatus: (id: string) => Promise<ExtOk<{extension: ExtRow | null}> | ExtErr>;
	installExtension: (dir: string) => Promise<ExtOk<{id: string}> | ExtErr>;
	uninstallExtension: (id: string) => Promise<ExtOk<Record<string, never>> | ExtErr>;
};

export function restartHint(row: Pick<ExtRow, 'hotUnload'>): string | undefined {
	return row.hotUnload ? undefined : '需重启';
}

export function extensionPayload(row: ExtRow): ExtRow {
	return {...row, restartHint: restartHint(row)};
}

export const extAdminMethods = [
	'listExtensions',
	'extensionStatus',
	'installExtension',
	'uninstallExtension'
] as const;
