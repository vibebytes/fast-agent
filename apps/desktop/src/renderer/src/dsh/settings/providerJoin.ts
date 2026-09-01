import {atPath, hasPath, nsOf, type SettingsDescribe, type SettingsNs} from './settings';

export type ProviderEntry = {
	provider: string;
	displayName: string;
	settingsNs: string;
	settingsPath: string[];
	active: boolean;
	declared?: boolean;
};

export type Cred = {configured?: boolean; source?: string; writable?: boolean};

export type ProviderRow = {
	entry: ProviderEntry;
	configured: boolean;
	removable: boolean;
	apiKeyEnv?: string;
	credential?: Cred;
	namespace?: SettingsNs;
};

export function deriveKeyRef(provider: string): string {
	return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
}

export function apiKeyEnvOf(ns: SettingsNs | undefined, path: readonly string[]): string | undefined {
	const profile = atPath(ns?.value, path);
	if (!profile || typeof profile !== 'object') return undefined;
	const ref = (profile as {apiKeyEnv?: unknown}).apiKeyEnv;
	return typeof ref === 'string' && ref.length > 0 ? ref : undefined;
}

export function joinProviders(
	entries: ProviderEntry[],
	describe: SettingsDescribe | null,
	creds: Record<string, Cred>
): ProviderRow[] {
	return entries.map(entry => {
		const namespace = nsOf(describe, entry.settingsNs);
		const configured =
			namespace !== undefined &&
			(entry.settingsPath.length === 0 || atPath(namespace.value, entry.settingsPath) !== undefined);
		const removable =
			namespace !== undefined &&
			entry.settingsPath.length > 0 &&
			hasPath(namespace.user, entry.settingsPath) &&
			!hasPath(namespace.base, entry.settingsPath);
		const apiKeyEnv = apiKeyEnvOf(namespace, entry.settingsPath);
		return {
			entry,
			configured,
			removable,
			apiKeyEnv,
			credential: apiKeyEnv ? creds[apiKeyEnv] : undefined,
			namespace
		};
	});
}

const LEGAL_KEY = /^[\x21-\x7E]+$/;
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/;

export function keyFailure(draft: string): 'keyBlank' | 'keyIllegal' | undefined {
	if (draft.length === 0) return undefined;
	const value = draft.trim();
	if (value.length === 0) return 'keyBlank';
	const quoted =
		(value.startsWith('"') || value.startsWith("'") || value.startsWith('`')) &&
		value.length > 1 &&
		value.endsWith(value[0]!);
	if (ENV_LINE.test(value) || quoted || !LEGAL_KEY.test(value)) return 'keyIllegal';
	return undefined;
}

export const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return structuredClone(value) as Record<string, unknown>;
}

export function pathOps(
	base: readonly string[],
	before: unknown,
	after: Record<string, unknown>
): Array<{op: 'set'; path: string[]; value: unknown} | {op: 'unset'; path: string[]}> {
	const previous = asRecord(before);
	const ops: Array<{op: 'set'; path: string[]; value: unknown} | {op: 'unset'; path: string[]}> = [];
	for (const [key, value] of Object.entries(after)) {
		if (JSON.stringify(previous[key]) === JSON.stringify(value)) continue;
		ops.push({op: 'set', path: [...base, key], value});
	}
	for (const key of Object.keys(previous)) {
		if (!(key in after)) ops.push({op: 'unset', path: [...base, key]});
	}
	return ops;
}

export type CatalogRow = {id: string; name?: string};

/** Editor rows: keep blank ids so「添加模型」能落下空行。 */
export function catalogRows(value: unknown): CatalogRow[] {
	if (!Array.isArray(value)) return [];
	return value.map(entry => {
		if (!entry || typeof entry !== 'object') return {id: ''};
		const id = (entry as {id?: unknown}).id;
		const name = (entry as {name?: unknown}).name;
		return {
			id: typeof id === 'string' ? id : '',
			...(typeof name === 'string' ? {name} : {})
		};
	});
}

/** Saved / inherited catalog: drop unfinished rows. */
export function modelRows(value: unknown): CatalogRow[] {
	return catalogRows(value).filter(row => row.id.trim().length > 0);
}

export function modelIssue(
	models: CatalogRow[]
): {index: number; key: 'modelIdRequired' | 'modelIdDuplicate'} | undefined {
	const seen = new Set<string>();
	for (const [index, row] of models.entries()) {
		const id = row.id.trim();
		if (!id) return {index, key: 'modelIdRequired'};
		if (seen.has(id)) return {index, key: 'modelIdDuplicate'};
		seen.add(id);
	}
}
