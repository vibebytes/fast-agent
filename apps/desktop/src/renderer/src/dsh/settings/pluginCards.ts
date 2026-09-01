import {atPath, nsOf, type SettingsDescribe, type SettingsNs} from './settings';

export type FieldKind = 'number' | 'text' | 'secret';

export type FieldWrite = {kind: 'set'; value: unknown} | {kind: 'clear'};

export type Staged = {text: string; clear: boolean};

export type CardField = {
	key: string;
	kind: FieldKind;
	title: string;
	hint: string;
};

export type PluginCardSpec = {
	id: string;
	aliases: readonly string[];
	title: string;
	description: string;
	fields: CardField[];
};

/** DSH-Web `ui-settings-plugins` cards. Terminal ns is `shell` (not `bash`). */
export const pluginCards: PluginCardSpec[] = [
	{
		id: 'shell',
		aliases: ['shell', 'bash'],
		title: '终端',
		description: '限制 agent 运行的每一条命令。',
		fields: [
			{
				key: 'timeoutMs',
				kind: 'number',
				title: '命令超时（毫秒）',
				hint: '单条命令允许运行多久，超时即终止。'
			},
			{
				key: 'maxOutputBytes',
				kind: 'number',
				title: '单流输出上限（字节）',
				hint: '超出部分会转存到临时文件，而不是被丢弃。'
			}
		]
	},
	{
		id: 'agent-loop',
		aliases: ['agent-loop'],
		title: 'Agent 循环',
		description: 'Agent 如何派发工具调用。',
		fields: [
			{
				key: 'maxParallelToolCalls',
				kind: 'number',
				title: '并行工具调用数',
				hint: '同一步内最多同时运行多少个可并行的调用。'
			}
		]
	},
	{
		id: 'web-search',
		aliases: ['web-search-deepseek'],
		title: '网页搜索',
		description: 'DeepSeek 搜索提供方。',
		fields: [
			{
				key: 'apiKey',
				kind: 'secret',
				title: 'API Key',
				hint: '不写入设置文件。留空表示保持当前密钥。'
			},
			{
				key: 'baseURL',
				kind: 'text',
				title: '接口地址',
				hint: '留空则使用提供方默认地址。'
			},
			{
				key: 'maxUses',
				kind: 'number',
				title: '单次请求最多搜索次数',
				hint: '一次请求在必须作答前最多可以搜索多少次。'
			}
		]
	}
];

export function pluginNs(describe: SettingsDescribe | null, aliases: readonly string[]): SettingsNs | undefined {
	for (const name of aliases) {
		const view = nsOf(describe, name);
		if (view) return view;
	}
}

export function formatField(kind: FieldKind, value: unknown): string {
	if (kind === 'secret') return '';
	if (kind === 'number') return typeof value === 'number' ? String(value) : '';
	return typeof value === 'string' ? value : '';
}

export function parseField(kind: FieldKind, text: string): FieldWrite | undefined {
	if (kind === 'secret') {
		const trimmed = text.trim();
		return trimmed === '' ? undefined : {kind: 'set', value: trimmed};
	}
	const trimmed = text.trim();
	if (kind === 'number') {
		if (trimmed === '') return {kind: 'clear'};
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? {kind: 'set', value: parsed} : undefined;
	}
	return trimmed === '' ? {kind: 'clear'} : {kind: 'set', value: trimmed};
}

export function sectionValue(view: SettingsNs | undefined, key: string): unknown {
	return atPath(view?.value, [key]);
}

export function fieldStored(view: SettingsNs | undefined, key: string): boolean {
	const user = view?.user;
	return user !== undefined && user !== null && typeof user === 'object' && key in user;
}

export function keyRef(view: SettingsNs | undefined): string {
	const declared = atPath(view?.value, ['apiKeyEnv']);
	return typeof declared === 'string' && declared.length > 0 ? declared : 'DEEPSEEK_API_KEY';
}

export type Planned =
	| {key: string; op: 'set'; value: unknown}
	| {key: string; op: 'unset'}
	| {key: string; op: 'secret'; value: string}
	| {key: string; op: 'invalid'};

/** Same skip / clear / refuse rules as DSH `CardForm.plan`. */
export function planField(
	field: CardField,
	staged: Staged | undefined,
	current: unknown,
	stored: boolean
): Planned | undefined {
	if (!staged) return undefined;
	if (field.kind === 'secret') {
		const value = staged.text.trim();
		return value === '' ? undefined : {key: field.key, op: 'secret', value};
	}
	if (staged.clear) return stored ? {key: field.key, op: 'unset'} : undefined;
	if (staged.text === formatField(field.kind, current)) return undefined;
	const write = parseField(field.kind, staged.text);
	if (write === undefined) return {key: field.key, op: 'invalid'};
	if (write.kind === 'clear') return {key: field.key, op: 'unset'};
	return {key: field.key, op: 'set', value: write.value};
}

export function fieldView(
	field: CardField,
	staged: Staged | undefined,
	current: unknown,
	stored: boolean
): {text: string; overridden: boolean; invalid: boolean} {
	if (field.kind === 'secret') {
		return {text: staged?.text ?? '', overridden: false, invalid: false};
	}
	if (!staged) {
		return {text: formatField(field.kind, current), overridden: stored, invalid: false};
	}
	const write = staged.clear ? {kind: 'clear' as const} : parseField(field.kind, staged.text);
	return {
		text: staged.text,
		overridden: write?.kind === 'set',
		invalid: write === undefined
	};
}

export type InventoryEntry = {
	entryId: string;
	moduleName: string;
	enabled: boolean;
	fiberPhase: string | null;
};

export function asInventory(value: unknown): InventoryEntry[] {
	if (!value || typeof value !== 'object') return [];
	const rows = (value as {entries?: unknown}).entries;
	if (!Array.isArray(rows)) return [];
	return rows.flatMap(row => {
		if (!row || typeof row !== 'object') return [];
		const r = row as Record<string, unknown>;
		if (typeof r.entryId !== 'string' || typeof r.moduleName !== 'string') return [];
		return [
			{
				entryId: r.entryId,
				moduleName: r.moduleName,
				enabled: r.enabled === true,
				fiberPhase: typeof r.fiberPhase === 'string' ? r.fiberPhase : null
			}
		];
	});
}

export function moduleShortName(moduleName: string): string {
	const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName;
	return unscoped
		.replace(/^cordis:/, '')
		.replace(/^cordis-plugin-/, '')
		.replace(/^dsh-(?:host-|client-)?/, '');
}

export function inventoryMatches(entry: InventoryEntry, query: string): boolean {
	const q = query.trim().toLocaleLowerCase();
	if (q.length === 0) return true;
	return [entry.moduleName, entry.entryId].some(v => v.toLocaleLowerCase().includes(q));
}

export const fiberCopy: Record<string, string> = {
	pending: '等待依赖',
	loading: '加载中',
	active: '已挂载',
	failed: '挂载失败',
	unloading: '卸载中'
};

export function fiberLabel(phase: string | null): string {
	return phase === null ? '未挂载' : (fiberCopy[phase] ?? phase);
}
