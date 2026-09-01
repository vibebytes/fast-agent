import type {DshCallResult, DshSettingsOp} from '@fast-ide/session-view';

type DshCall = (
	method: string,
	payload?: Record<string, unknown>,
	sessionId?: string
) => Promise<DshCallResult>;

export type SettingsHop = {
	method: string;
	payload: Record<string, unknown>;
	sessionId?: string;
};

/** `op` → DSH unary. Method names live only here. */
export function settingsHop(op: DshSettingsOp): SettingsHop {
	switch (op.op) {
		case 'describe':
			return {method: 'settings.describe', payload: {}};
		case 'update':
			return {
				method: 'settings.update',
				payload: {
					ns: op.ns,
					patch: op.patch,
					...(op.expectedRevision !== undefined ? {expectedRevision: op.expectedRevision} : {})
				}
			};
		case 'mutate':
			return {
				method: 'settings.mutate',
				payload: {
					ns: op.ns,
					ops: op.ops,
					...(op.expectedRevision !== undefined ? {expectedRevision: op.expectedRevision} : {})
				}
			};
		case 'replace':
			return {
				method: 'settings.replace',
				payload: {
					ns: op.ns,
					section: op.section,
					...(op.expectedRevision !== undefined ? {expectedRevision: op.expectedRevision} : {})
				}
			};
		case 'openDocument':
			return {method: 'settings.openDocument', payload: {}};
		case 'credentialsDescribe':
			return {method: 'credentials.describe', payload: {refs: op.refs}};
		case 'credentialsSet':
			return {method: 'credentials.set', payload: {ref: op.ref, value: op.value}};
		case 'credentialsUnset':
			return {method: 'credentials.unset', payload: {ref: op.ref}};
		case 'llmModels':
			return {method: 'llm.models', payload: {}};
		case 'llmProviders':
			return {method: 'llm.providers', payload: {}};
		case 'llmDiscoverModels':
			return {method: 'llm.discoverModels', payload: op.input};
		case 'agentPresetList':
			return {method: 'agentPreset.list', payload: {}};
		case 'agentPresetSelect':
			return {
				method: 'agentPreset.select',
				payload: {sessionId: op.sessionId, agentPreset: op.agentPreset},
				sessionId: op.sessionId
			};
		case 'agentPresetRead':
			return {method: 'agentPreset.read', payload: {agentPreset: op.agentPreset}};
		case 'agentPresetCopy': {
			const name = op.name?.trim();
			return {
				method: 'agentPreset.copy',
				payload: {
					from: op.from,
					agentPreset: op.agentPreset,
					...(name ? {name} : {})
				}
			};
		}
		case 'agentPresetOpenDocument':
			return {method: 'agentPreset.openDocument', payload: {agentPreset: op.agentPreset}};
		case 'agentPresetRemove':
			return {method: 'agentPreset.remove', payload: {agentPreset: op.agentPreset}};
		case 'sessionList':
			return {method: 'session.list', payload: {}};
		case 'pluginInventoryList':
			return {method: 'pluginInventory.list', payload: {}};
	}
}

export function settingsCall(call: DshCall, op: DshSettingsOp): Promise<DshCallResult> {
	const hop = settingsHop(op);
	return call(hop.method, hop.payload, hop.sessionId);
}
