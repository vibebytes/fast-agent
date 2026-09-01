import type {DshCallResult, DshError} from '@fast-ide/session-view';

export type SettingsNs = {
	ns: string;
	schema: unknown;
	value: unknown;
	base?: unknown;
	user?: unknown;
	revision: number;
	applies?: string;
	secrets?: Array<{path: string[]; set: boolean}>;
};

export type SchemaField = {
	key: string;
	type: string;
	title: string;
	description?: string;
	enum?: string[];
	choices?: Array<{id: string; label: string}>;
	fallback?: unknown;
	role?: string;
};

export type SettingsDescribe = {
	writable: boolean;
	hasDocument: boolean;
	namespaces: SettingsNs[];
};

export function asDescribe(value: unknown): SettingsDescribe | null {
	if (!value || typeof value !== 'object') return null;
	const v = value as Record<string, unknown>;
	if (!Array.isArray(v.namespaces)) return null;
	return {
		writable: v.writable === true,
		hasDocument: v.hasDocument === true,
		namespaces: v.namespaces as SettingsNs[]
	};
}

export function nsOf(desc: SettingsDescribe | null, name: string): SettingsNs | undefined {
	return desc?.namespaces.find(n => n.ns === name);
}

export async function dshDescribe(): Promise<
	{ok: true; value: SettingsDescribe} | {ok: false; error: DshError}
> {
	const result = await window.fastIde.dshSettings.describe();
	if (!result.ok) return result;
	const parsed = asDescribe(result.value);
	if (!parsed) return {ok: false, error: {code: 'internal', message: 'settings.describe shape'}};
	return {ok: true, value: parsed};
}

export function isConflict(error: {code: string; message?: string}): boolean {
	return (
		error.code === 'settings-conflict' ||
		error.code === 'revision-stale' ||
		(typeof error.message === 'string' && error.message.includes('changed since it was read'))
	);
}

export async function dshUpdate(
	ns: string,
	patch: Record<string, unknown>,
	expectedRevision?: number
): Promise<DshCallResult> {
	return window.fastIde.dshSettings.update({ns, patch, expectedRevision});
}

/** Re-read revision immediately before write; retry once on `settings-conflict`. */
export async function dshUpdateFresh(
	ns: string,
	patch: Record<string, unknown>
): Promise<DshCallResult> {
	const described = await dshDescribe();
	if (!described.ok) return described;
	const first = await dshUpdate(ns, patch, nsOf(described.value, ns)?.revision);
	if (first.ok || !isConflict(first.error)) return first;
	const again = await dshDescribe();
	if (!again.ok) return first;
	return dshUpdate(ns, patch, nsOf(again.value, ns)?.revision);
}

export async function dshMutate(
	ns: string,
	ops: Array<{op: 'set'; path: string[]; value: unknown} | {op: 'unset'; path: string[]}>,
	expectedRevision?: number
): Promise<DshCallResult> {
	return window.fastIde.dshSettings.mutate({ns, ops, expectedRevision});
}

export async function dshReplace(
	ns: string,
	section: Record<string, unknown>,
	expectedRevision?: number
): Promise<DshCallResult> {
	return window.fastIde.dshSettings.replace({ns, section, expectedRevision});
}

type SchemaNode = {
	type?: string;
	meta?: {description?: unknown; default?: unknown; role?: unknown};
	value?: unknown;
	list?: Array<number | SchemaNode>;
	dict?: Record<string, number | SchemaNode>;
	inner?: number | SchemaNode;
};

type SchemaEnvelope = {
	uid?: number;
	refs?: Record<string, SchemaNode>;
	properties?: Record<string, unknown>;
};

function nodeOf(schema: SchemaEnvelope, id: number | SchemaNode | undefined): SchemaNode | undefined {
	if (id == null) return undefined;
	if (typeof id === 'object') return id;
	return schema.refs?.[String(id)];
}

function constChoices(schema: SchemaEnvelope, node: SchemaNode | undefined): Array<{id: string; label: string}> {
	if (!node) return [];
	if (node.type === 'const' && typeof node.value === 'string') {
		const described = node.meta?.description;
		return [{id: node.value, label: typeof described === 'string' && described ? described : node.value}];
	}
	if (node.type === 'union' && Array.isArray(node.list)) {
		return node.list.flatMap(item => constChoices(schema, nodeOf(schema, item)));
	}
	return [];
}

function jsonSchemaFields(props: Record<string, unknown>): SchemaField[] {
	return Object.entries(props).map(([key, raw]) => {
		const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
		const enums = Array.isArray(p.enum) ? p.enum.filter((x): x is string => typeof x === 'string') : undefined;
		return {
			key,
			type: typeof p.type === 'string' ? p.type : 'string',
			title: typeof p.title === 'string' ? p.title : key,
			description: typeof p.description === 'string' ? p.description : undefined,
			enum: enums,
			choices: enums?.map(id => ({id, label: id})),
			fallback: p.default
		};
	});
}

/** DSH `settings.describe` schema is schemastery `{uid, refs}`; JSON Schema `properties` still accepted. */
export function schemaFields(schema: unknown): SchemaField[] {
	if (!schema || typeof schema !== 'object') return [];
	const env = schema as SchemaEnvelope;
	if (env.properties && typeof env.properties === 'object') return jsonSchemaFields(env.properties);
	const root = env.uid != null ? nodeOf(env, env.uid) : (env as SchemaNode);
	if (!root || root.type !== 'object' || !root.dict) return [];
	return Object.entries(root.dict).flatMap(([key, ref]) => {
		const node = nodeOf(env, ref);
		if (!node) return [];
		const role = typeof node.meta?.role === 'string' ? node.meta.role : undefined;
		if (role === 'secret') return [];
		const choices = constChoices(env, node);
		const enums = choices.map(c => c.id);
		return [
			{
				key,
				type: node.type === 'number' ? 'number' : node.type === 'boolean' ? 'boolean' : 'string',
				title: key,
				description: typeof node.meta?.description === 'string' ? node.meta.description : undefined,
				enum: enums.length > 0 ? enums : undefined,
				choices: choices.length > 0 ? choices : undefined,
				fallback: node.meta?.default,
				role
			}
		];
	});
}

export function fieldValue(value: unknown, key: string, fallback?: unknown): unknown {
	if (value && typeof value === 'object' && key in (value as object)) {
		return (value as Record<string, unknown>)[key];
	}
	return fallback;
}

export function atPath(value: unknown, path: readonly string[]): unknown {
	return path.reduce<unknown>((cur, key) => {
		if (!cur || typeof cur !== 'object') return undefined;
		return (cur as Record<string, unknown>)[key];
	}, value);
}

export function hasPath(value: unknown, path: readonly string[]): boolean {
	if (path.length === 0) return value !== undefined;
	let cur: unknown = value;
	for (const key of path) {
		if (!cur || typeof cur !== 'object' || !(key in (cur as object))) return false;
		cur = (cur as Record<string, unknown>)[key];
	}
	return true;
}

/** Wire protocols a hand-declared `llm-pi-ai` route may name (`providers.*.api`). */
export function protocolChoices(schema: unknown): string[] {
	if (!schema || typeof schema !== 'object') return [];
	const env = schema as SchemaEnvelope;
	const root = env.uid != null ? nodeOf(env, env.uid) : (env as SchemaNode);
	const providers = nodeOf(env, root?.dict?.providers);
	if (!providers) return [];
	const profile = providers.type === 'dict' ? nodeOf(env, providers.inner) : providers;
	return constChoices(env, nodeOf(env, profile?.dict?.api)).map(c => c.id);
}
