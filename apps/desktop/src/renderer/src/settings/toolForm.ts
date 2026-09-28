import type {ConfigurableTool, ConfigurableToolField, PutConfigurableToolInput} from '@fast-ide/session-view';

export type ToolsSurface = 'disabled' | 'loading' | 'error' | 'empty' | 'list';

/** What the tools pane renders. Engine-not-ready is the disabled empty state. */
export function toolsSurface(tools: {engineReady: boolean; status: string; tools: readonly unknown[]}): ToolsSurface {
	if (!tools.engineReady || tools.status === 'disabled') return 'disabled';
	if (tools.status === 'loading' && tools.tools.length === 0) return 'loading';
	if (tools.status === 'error' && tools.tools.length === 0) return 'error';
	if (tools.tools.length === 0) return 'empty';
	return 'list';
}

/** Non-secret values already stored. Secrets stay blank; the placeholder shows last4. */
export function draftsFrom(tool: ConfigurableTool): Record<string, string> {
	const drafts: Record<string, string> = {};
	for (const field of tool.fields) {
		const value = tool.values[field.key];
		if (field.type === 'toggle' && typeof value === 'boolean') drafts[field.key] = value ? 'true' : 'false';
		else if (field.type === 'number' && typeof value === 'number' && Number.isFinite(value)) drafts[field.key] = String(value);
		else if ((field.type === 'text' || field.type === 'choice') && typeof value === 'string') drafts[field.key] = value;
	}
	return drafts;
}

export type ToolFormSubmit = {kind: 'hold'} | {kind: 'save'; input: PutConfigurableToolInput};

/**
 * Build a save from the schema-driven drafts.
 * A required secret that is empty and has no last4 does not request enable.
 * Clearing that secret still saves, with enable left off, so the secret row is deleted.
 */
export function submitToolForm(
	tool: ConfigurableTool,
	drafts: Record<string, string>,
	cleared: Record<string, boolean>
): ToolFormSubmit {
	const secrets: Record<string, string> = {};
	const clearSecrets: string[] = [];
	const values: Record<string, unknown> = {};
	let missingRequired = false;
	for (const field of tool.fields) {
		const draft = (drafts[field.key] ?? '').trim();
		if (field.type === 'secret') collectSecret(tool, field, draft, Boolean(cleared[field.key]), secrets, clearSecrets, () => {
			missingRequired = true;
		});
		else collectValue(field, draft, field.key in drafts, values, () => {
			missingRequired = true;
		});
	}
	const clearingRequired = clearSecrets.length > 0 && missingRequired;
	if (missingRequired && !clearingRequired) return {kind: 'hold'};
	return {
		kind: 'save',
		input: {name: tool.name, enabled: !missingRequired, values, secrets, clearSecrets}
	};
}

function collectSecret(
	tool: ConfigurableTool,
	field: ConfigurableToolField,
	draft: string,
	cleared: boolean,
	secrets: Record<string, string>,
	clearSecrets: string[],
	missing: () => void
): void {
	const wiped = cleared && !draft;
	if (draft) secrets[field.key] = draft;
	else if (wiped) clearSecrets.push(field.key);
	const kept = !wiped && Boolean(tool.secrets[field.key]?.present);
	if (field.required && !draft && !kept) missing();
}

function collectValue(
	field: ConfigurableToolField,
	draft: string,
	touched: boolean,
	values: Record<string, unknown>,
	missing: () => void
): void {
	if (field.type === 'toggle') {
		if (draft === 'true' || draft === 'false') values[field.key] = draft === 'true';
		else if (field.required) missing();
		return;
	}
	if (field.type === 'number') {
		if (!draft) {
			if (field.required) missing();
			else if (touched) values[field.key] = null;
			return;
		}
		const n = Number(draft);
		if (Number.isFinite(n)) values[field.key] = n;
		else if (field.required) missing();
		return;
	}
	if (draft) values[field.key] = draft;
	else if (field.required) missing();
	else if (touched) values[field.key] = '';
}
