import type {EngineWireRow} from '@fast-ide/session-view';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {hostRequest, type CommandResult, type HostLane} from './hostWait.js';

type Notice = {ok: false; notice: string};
type ExtWireRow = NonNullable<Extract<BridgeEvent, {type: 'command_result'}>['extensions']>[number];
type ExtWireNote = NonNullable<Extract<BridgeEvent, {type: 'command_result'}>['ledger']>[number];

export type PluginLane = HostLane & {
	hostOpen: () => boolean;
	applyEngines: (rows: EngineWireRow[]) => void;
};

export type WorkspacePlugins = {
	listExtensions: () => Promise<{ok: true; extensions: ExtWireRow[]; ledger: ExtWireNote[]} | Notice>;
	extensionStatus: (id: string) => Promise<{ok: true; extension: ExtWireRow | null} | Notice>;
	installExtension: (dir: string) => Promise<{ok: true; id: string} | Notice>;
	uninstallExtension: (id: string) => Promise<{ok: true} | Notice>;
	listEngines: () => Promise<{ok: true; engines: EngineWireRow[]} | Notice>;
	writeEngine: (
		type:
			| 'EnableEngine'
			| 'DisableEngine'
			| 'StartEngine'
			| 'StopEngine'
			| 'SetDefaultEngine'
			| 'InstallEngine'
			| 'UninstallEngine'
			| 'CancelEngineInstall',
		id: string
	) => Promise<{ok: true; engines: EngineWireRow[]} | Notice>;
};

function extensionsFromEvent(event: CommandResult): ExtWireRow[] {
	const raw = event.extensions;
	return Array.isArray(raw) ? raw : [];
}

function enginesFromEvent(event: CommandResult): EngineWireRow[] {
	const raw = event.engines;
	return Array.isArray(raw) ? (raw as EngineWireRow[]) : [];
}

function ledgerFromEvent(event: CommandResult): ExtWireNote[] {
	const raw = event.ledger;
	return Array.isArray(raw) ? raw : [];
}

export function createPlugins(lane: PluginLane): WorkspacePlugins {
	const readyLane: HostLane = {
		...lane,
		ready: () => lane.hostOpen()
	};

	return {
		async listExtensions() {
			const r = await hostRequest(lane, ['ListExtensions'], {type: 'ListExtensions'});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			return {ok: true, extensions: extensionsFromEvent(r.event), ledger: ledgerFromEvent(r.event)};
		},
		async extensionStatus(id) {
			const r = await hostRequest(lane, ['ExtensionStatus'], {type: 'ExtensionStatus', id});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			return {ok: true, extension: extensionsFromEvent(r.event)[0] ?? null};
		},
		async installExtension(dir) {
			const r = await hostRequest(lane, ['InstallExtension'], {type: 'InstallExtension', dir});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			const name = dir.split(/[\\/]/).filter(Boolean).at(-1) ?? dir;
			return {ok: true, id: name};
		},
		async uninstallExtension(id) {
			const r = await hostRequest(lane, ['UninstallExtension'], {type: 'UninstallExtension', id});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			return {ok: true};
		},
		async listEngines() {
			const r = await hostRequest(readyLane, ['ListEngines'], {type: 'ListEngines'});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			const engines = enginesFromEvent(r.event);
			lane.applyEngines(engines);
			return {ok: true, engines};
		},
		async writeEngine(type, id) {
			const timeoutMs = type === 'InstallEngine' ? 15 * 60_000 : 12_000;
			const r = await hostRequest(readyLane, [type], {type, id}, {timeoutMs});
			if (!r.ok) return r;
			if (r.event.status === 'error' || r.event.status === 'rejected') {
				return {ok: false, notice: r.event.message};
			}
			const engines = enginesFromEvent(r.event);
			lane.applyEngines(engines);
			return {ok: true, engines};
		}
	};
}
