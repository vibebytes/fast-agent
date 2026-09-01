export type EngineRow = {
	id: string;
	kind: 'builtin' | 'extension';
	adapter: 'ready' | 'disabled' | 'failed';
	program: 'builtin' | 'installed' | 'missing' | 'installing';
	process: 'none' | 'stopped' | 'running';
	processDetail?: string;
	isDefault: boolean;
	inRegistry: boolean;
	actions: string[];
	installLog?: Array<{stream: 'stdout' | 'stderr'; text: string; seq: number}>;
};

export type EngOk<T> = {ok: true} & T;
export type EngErr = {ok: false; notice: string};

export type EngAdminApi = {
	listEngines: () => Promise<EngOk<{engines: EngineRow[]}> | EngErr>;
	enableEngine: (id: string) => Promise<EngOk<{engines: EngineRow[]}> | EngErr>;
	disableEngine: (id: string) => Promise<EngOk<{engines: EngineRow[]}> | EngErr>;
	startEngine: (id: string) => Promise<EngOk<{engines: EngineRow[]}> | EngErr>;
	stopEngine: (id: string) => Promise<EngOk<{engines: EngineRow[]}> | EngErr>;
	setDefaultEngine: (id: string) => Promise<EngOk<{engines: EngineRow[]}> | EngErr>;
	installEngine: (id: string) => Promise<EngOk<{engines: EngineRow[]}> | EngErr>;
	uninstallEngine: (id: string) => Promise<EngOk<{engines: EngineRow[]}> | EngErr>;
	cancelEngineInstall: (id: string) => Promise<EngOk<{engines: EngineRow[]}> | EngErr>;
	onEngineInstallLog?: (
		handler: (log: {engineId: string; stream: 'stdout' | 'stderr'; text: string; seq: number}) => void
	) => () => void;
};

export const engAdminMethods = [
	'listEngines',
	'enableEngine',
	'disableEngine',
	'startEngine',
	'stopEngine',
	'setDefaultEngine',
	'installEngine',
	'uninstallEngine',
	'cancelEngineInstall'
] as const;
