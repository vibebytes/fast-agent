import type {BridgeEvent} from '@fastllm/bridge-protocol';
import type {ContextInjectionView, TranscriptState} from './state.js';

/**
 * Engine-injected context (recall / plugin snapshot) is not a chat bubble.
 * Rows are keyed by runId + label so a re-emitted snapshot replaces its predecessor
 * instead of stacking duplicates.
 */
export function applyContextInjected(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'context_injected'}>
): TranscriptState {
	const row: ContextInjectionView = {
		id: `${event.runId}:${event.label}`,
		runId: event.runId,
		sourceKind: event.sourceKind,
		form: event.form,
		label: event.label,
		text: event.text
	};
	const rows = state.contextInjections ?? [];
	const at = rows.findIndex(r => r.id === row.id);
	const next = at >= 0 ? rows.map((r, i) => (i === at ? row : r)) : [...rows, row];
	return {...state, contextInjections: next};
}
