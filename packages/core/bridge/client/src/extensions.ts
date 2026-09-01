export type ExtPhase = 'Installed' | 'Active' | 'Stopping' | 'Uninstalled' | 'Failed';

export type ExtRow = {
	id: string;
	phase: ExtPhase;
	hotUnload: boolean;
	fault?: string;
	restartHint?: string;
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
