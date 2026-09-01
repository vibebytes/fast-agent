import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {isWriteTool, type CodeChange} from '@fast-ide/session-view';

export type CodeChangeEntry = CodeChange;

export type CodeChangesState = {
	entries: CodeChangeEntry[];
};

function pathFromRecord(record?: Record<string, string>): string | undefined {
	if (!record) return undefined;
	return record.path ?? record.file ?? record.filepath ?? record.file_path ?? record.target;
}

export function createCodeChangesState(): CodeChangesState {
	return {entries: []};
}

/**
 * Project Bridge events into a read-only Code Changes list.
 * When the protocol has no dedicated diff events, write-like tools with a path
 * are the only source; otherwise the state stays empty (UI shows placeholder).
 * Write detection shares `isWriteTool` with Transcript file cards (session-view).
 */
export function applyCodeChangeEvent(state: CodeChangesState, event: BridgeEvent): CodeChangesState {
	switch (event.type) {
		case 'tool_started': {
			if (!isWriteTool(event.tool)) return state;
			const path = pathFromRecord(event.args);
			if (!path) return state;
			const entry: CodeChangeEntry = {
				id: event.id,
				path,
				tool: event.tool,
				status: 'running',
				summary: event.args?.description
			};
			return {
				entries: [...state.entries.filter(e => e.id !== event.id), entry]
			};
		}
		case 'tool_finished': {
			const existing = state.entries.find(e => e.id === event.id);
			const path = pathFromRecord(event.fields) ?? existing?.path;
			if (!existing && !(isWriteTool(event.tool) && path)) return state;
			if (!path) return state;
			const entry: CodeChangeEntry = {
				id: event.id,
				path,
				tool: event.tool,
				status: event.success ? 'done' : 'error',
				diff: event.fields.diff ?? event.fields.patch,
				summary: event.fields.summary ?? existing?.summary
			};
			return {
				entries: [...state.entries.filter(e => e.id !== event.id), entry]
			};
		}
		default:
			return state;
	}
}
