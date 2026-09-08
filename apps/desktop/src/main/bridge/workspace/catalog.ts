import type {
	CreateSkillInput,
	MarketSkillRow,
	MobilePairingInfo,
	ProviderModelPatch,
	ProviderRow,
	SearchModelRow,
	SettingsDoc,
	SettingsScope,
	SkillRow,
	UpsertProviderInput
} from '@fast-ide/session-view';
import {hostRequest, type CommandResult, type HostLane} from './hostWait.js';

type Notice = {ok: false; notice: string};
type RawPairing = {
	available?: boolean;
	reason?: string;
	host?: string;
	port?: number;
	serverUrl?: string;
	token?: string;
	fingerprint?: string;
};

export function pairingUnavailable(
	reason: 'engine' | 'off' | 'no_lan',
	error?: string
): MobilePairingInfo {
	return {
		available: false,
		reason,
		host: '',
		port: 0,
		serverUrl: '',
		token: '',
		fingerprint: '',
		...(error ? {error} : {})
	};
}

export function pairingFromRaw(raw: RawPairing | undefined | null): MobilePairingInfo {
	if (raw?.available && raw.serverUrl && raw.token && raw.fingerprint) {
		return {
			available: true,
			host: raw.host ?? '',
			port: raw.port ?? 0,
			serverUrl: raw.serverUrl,
			token: raw.token,
			fingerprint: raw.fingerprint
		};
	}
	const token = raw?.token ?? '';
	const fingerprint = raw?.fingerprint ?? '';
	if (raw?.reason === 'loopback_only') return {...pairingUnavailable('no_lan'), token, fingerprint};
	return {...pairingUnavailable('off'), token, fingerprint};
}

export function providersFromEvent(event: CommandResult): ProviderRow[] {
	const raw = (event as {providers?: ProviderRow[]}).providers;
	return Array.isArray(raw) ? raw : [];
}

export function skillsFromEvent(event: CommandResult): SkillRow[] {
	const raw = (event as {skills?: SkillRow[]}).skills;
	return Array.isArray(raw) ? raw : [];
}

export function marketSkillsFromEvent(event: CommandResult): MarketSkillRow[] {
	const raw = (event as {marketSkills?: MarketSkillRow[]}).marketSkills;
	return Array.isArray(raw) ? raw : [];
}

export type WorkspaceCatalog = {
	getSettings: (
		scope: SettingsScope,
		scopeId?: string
	) => Promise<{ok: true; settings: SettingsDoc[]} | Notice>;
	patchSettings: (
		scope: 'global' | 'project',
		namespace: string,
		patch: unknown,
		scopeId?: string
	) => Promise<{ok: true; setting: SettingsDoc} | Notice>;
	getBridgePairing: () => Promise<MobilePairingInfo>;
	setLanPairing: (enabled: boolean) => Promise<MobilePairingInfo>;
	listProviders: () => Promise<{ok: true; providers: ProviderRow[]} | Notice>;
	upsertProvider: (input: UpsertProviderInput) => Promise<{ok: true; provider: ProviderRow} | Notice>;
	deleteProvider: (id: string) => Promise<{ok: true} | Notice>;
	setProviderEnabled: (id: string, enabled: boolean) => Promise<{ok: true; provider: ProviderRow} | Notice>;
	testProvider: (id: string) => Promise<{ok: true; provider: ProviderRow} | Notice>;
	patchProviderModels: (
		id: string,
		patch: ProviderModelPatch[]
	) => Promise<{ok: true; provider: ProviderRow} | Notice>;
	searchProviderModels: (
		id: string,
		query: string
	) => Promise<{ok: true; searchModels: SearchModelRow[]} | Notice>;
	listSkills: () => Promise<{ok: true; skills: SkillRow[]} | Notice>;
	createSkill: (input: CreateSkillInput) => Promise<{ok: true; skill: SkillRow} | Notice>;
	deleteSkill: (name: string, scope: string) => Promise<{ok: true} | Notice>;
	setSkillEnabled: (
		name: string,
		scope: string,
		enabled: boolean
	) => Promise<{ok: true; skill: SkillRow} | Notice>;
	searchSkillMarket: (
		query: string
	) => Promise<{ok: true; marketSkills: MarketSkillRow[]; message?: string} | Notice>;
	installSkillFromMarket: (source: string, scope: string) => Promise<{ok: true} | Notice>;
	uninstallSkillFromMarket: (name: string, scope: string) => Promise<{ok: true} | Notice>;
};

export function createCatalog(lane: HostLane): WorkspaceCatalog {
	const firstProvider = async (
		names: string[],
		cmd: Parameters<typeof hostRequest>[2],
		fail: string
	): Promise<{ok: true; provider: ProviderRow} | Notice> => {
		const r = await hostRequest(lane, names, cmd);
		if (!r.ok) return r;
		if (r.event.status === 'error') return {ok: false, notice: r.event.message};
		const provider = providersFromEvent(r.event)[0];
		if (!provider) return {ok: false, notice: fail};
		return {ok: true, provider};
	};

	return {
		async getSettings(scope, scopeId) {
			const r = await hostRequest(lane, ['GetSettings'], {
				type: 'GetSettings',
				scope,
				...(scopeId?.trim() ? {scopeId: scopeId.trim()} : {})
			});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			const settings = Array.isArray(r.event.settings) ? (r.event.settings as SettingsDoc[]) : [];
			return {ok: true, settings};
		},
		async patchSettings(scope, namespace, patch, scopeId) {
			const ns = namespace.trim();
			if (!ns) return {ok: false, notice: 'namespace required'};
			const r = await hostRequest(lane, ['PatchSettings'], {
				type: 'PatchSettings',
				scope,
				namespace: ns,
				patchJson: JSON.stringify(patch ?? {}),
				...(scopeId?.trim() ? {scopeId: scopeId.trim()} : {})
			});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			const setting = Array.isArray(r.event.settings)
				? (r.event.settings[0] as SettingsDoc | undefined)
				: undefined;
			if (!setting) return {ok: false, notice: 'PatchSettings returned no document'};
			return {ok: true, setting};
		},
		async getBridgePairing() {
			if (!lane.ready()) return pairingUnavailable('engine');
			const {token, promise} = lane.wait(['GetBridgePairing']);
			if (!lane.send({type: 'GetBridgePairing'})) {
				lane.cancel(token);
				return pairingUnavailable('engine');
			}
			try {
				return pairingFromRaw((await promise).pairing);
			} catch {
				return pairingUnavailable('engine');
			}
		},
		async setLanPairing(enabled) {
			if (!lane.ready()) return pairingUnavailable('engine');
			const {token, promise} = lane.wait(['SetLanPairing']);
			if (!lane.send({type: 'SetLanPairing', enabled})) {
				lane.cancel(token);
				return pairingUnavailable('engine');
			}
			try {
				const event = await promise;
				const info = pairingFromRaw(event.pairing);
				if (event.status === 'error') return {...info, error: event.message};
				return info;
			} catch {
				return pairingUnavailable('engine');
			}
		},
		async listProviders() {
			const r = await hostRequest(lane, ['ListProviders'], {type: 'ListProviders'});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			return {ok: true, providers: providersFromEvent(r.event)};
		},
		async upsertProvider(input) {
			const name = String(input.name ?? '').trim();
			if (!name) return {ok: false, notice: 'name required'};
			return firstProvider(
				['UpsertProvider'],
				{
					type: 'UpsertProvider',
					name,
					...(input.id?.trim() ? {id: input.id.trim()} : {}),
					...(input.presetKey?.trim() ? {presetKey: input.presetKey.trim()} : {}),
					...(input.baseUrl?.trim() ? {baseUrl: input.baseUrl.trim()} : {}),
					...(input.kind?.trim() ? {kind: input.kind.trim()} : {}),
					...(input.metaJson?.trim() ? {metaJson: input.metaJson.trim()} : {}),
					...(input.credential?.trim() ? {credential: input.credential.trim()} : {}),
					...(input.seedModelsJson?.trim() ? {seedModelsJson: input.seedModelsJson.trim()} : {})
				},
				'UpsertProvider returned no provider'
			);
		},
		async deleteProvider(id) {
			const trimmed = id.trim();
			if (!trimmed) return {ok: false, notice: 'id required'};
			const r = await hostRequest(lane, ['DeleteProvider'], {type: 'DeleteProvider', id: trimmed});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			return {ok: true};
		},
		setProviderEnabled: (id, enabled) => {
			const trimmed = id.trim();
			if (!trimmed) return Promise.resolve({ok: false as const, notice: 'id required'});
			return firstProvider(
				['SetProviderEnabled'],
				{type: 'SetProviderEnabled', id: trimmed, enabled},
				'SetProviderEnabled returned no provider'
			);
		},
		testProvider: id => {
			const trimmed = id.trim();
			if (!trimmed) return Promise.resolve({ok: false as const, notice: 'id required'});
			return firstProvider(
				['TestProvider'],
				{type: 'TestProvider', id: trimmed},
				'TestProvider returned no provider'
			);
		},
		patchProviderModels: (id, patch) => {
			const trimmed = id.trim();
			if (!trimmed) return Promise.resolve({ok: false as const, notice: 'id required'});
			return firstProvider(
				['PatchProviderModels'],
				{type: 'PatchProviderModels', id: trimmed, patchJson: JSON.stringify(patch ?? [])},
				'PatchProviderModels returned no provider'
			);
		},
		async searchProviderModels(id, query) {
			const trimmed = id.trim();
			if (!trimmed) return {ok: false, notice: 'id required'};
			const r = await hostRequest(lane, ['SearchProviderModels'], {
				type: 'SearchProviderModels',
				id: trimmed,
				query: String(query ?? '')
			});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			const raw = (r.event as {searchModels?: SearchModelRow[]}).searchModels;
			return {ok: true, searchModels: Array.isArray(raw) ? raw : []};
		},
		async listSkills() {
			const r = await hostRequest(lane, ['ListSkills'], {type: 'ListSkills'});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			return {ok: true, skills: skillsFromEvent(r.event)};
		},
		async createSkill(input) {
			const name = String(input.name ?? '').trim();
			const scope = String(input.scope ?? '').trim();
			if (!name) return {ok: false, notice: 'name required'};
			if (!scope) return {ok: false, notice: 'scope required'};
			const r = await hostRequest(lane, ['CreateSkill'], {
				type: 'CreateSkill',
				name,
				scope,
				...(input.template?.trim() ? {template: input.template.trim()} : {})
			});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			const skill = skillsFromEvent(r.event)[0];
			if (!skill) return {ok: false, notice: 'CreateSkill returned no skill'};
			return {ok: true, skill};
		},
		async deleteSkill(name, scope) {
			const trimmedName = name.trim();
			const trimmedScope = scope.trim();
			if (!trimmedName) return {ok: false, notice: 'name required'};
			if (!trimmedScope) return {ok: false, notice: 'scope required'};
			const r = await hostRequest(lane, ['DeleteSkill'], {
				type: 'DeleteSkill',
				name: trimmedName,
				scope: trimmedScope
			});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			return {ok: true};
		},
		async setSkillEnabled(name, scope, enabled) {
			const trimmedName = name.trim();
			const trimmedScope = scope.trim();
			if (!trimmedName) return {ok: false, notice: 'name required'};
			if (!trimmedScope) return {ok: false, notice: 'scope required'};
			const r = await hostRequest(lane, ['SetSkillEnabled'], {
				type: 'SetSkillEnabled',
				name: trimmedName,
				scope: trimmedScope,
				enabled
			});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			const skill = skillsFromEvent(r.event)[0];
			if (!skill) return {ok: false, notice: 'SetSkillEnabled returned no skill'};
			return {ok: true, skill};
		},
		async searchSkillMarket(query) {
			const r = await hostRequest(
				lane,
				['SearchSkillMarket'],
				{type: 'SearchSkillMarket', query: String(query ?? '')},
				{timeoutMs: 20_000}
			);
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			return {
				ok: true,
				marketSkills: marketSkillsFromEvent(r.event),
				...(typeof r.event.message === 'string' ? {message: r.event.message} : {})
			};
		},
		async installSkillFromMarket(source, scope) {
			const trimmedSource = source.trim();
			const trimmedScope = scope.trim();
			if (!trimmedSource) return {ok: false, notice: 'source required'};
			if (!trimmedScope) return {ok: false, notice: 'scope required'};
			const r = await hostRequest(
				lane,
				['InstallSkillFromMarket'],
				{type: 'InstallSkillFromMarket', source: trimmedSource, scope: trimmedScope},
				{timeoutMs: 120_000}
			);
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			return {ok: true};
		},
		async uninstallSkillFromMarket(name, scope) {
			const trimmedName = name.trim();
			const trimmedScope = scope.trim();
			if (!trimmedName) return {ok: false, notice: 'name required'};
			if (!trimmedScope) return {ok: false, notice: 'scope required'};
			const r = await hostRequest(lane, ['UninstallSkillFromMarket'], {
				type: 'UninstallSkillFromMarket',
				name: trimmedName,
				scope: trimmedScope
			});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			return {ok: true};
		}
	};
}
