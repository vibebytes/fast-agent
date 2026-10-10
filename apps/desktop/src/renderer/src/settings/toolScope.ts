import type {ConfigurableTool, ConfigurableToolField, PutConfigurableToolInput} from '@fast-ide/session-view';

export type SessionScopeChoice = 'main_only' | 'all_sessions';

export const SESSION_SCOPE_KEY = 'sessionScope';

export const SESSION_SCOPE_OPTIONS: readonly SessionScopeChoice[] = ['all_sessions', 'main_only'];

/** The stored session scope; anything missing or unknown falls back to the built-in default. */
export function scopeOf(values: Record<string, unknown> | undefined): SessionScopeChoice {
	return values?.[SESSION_SCOPE_KEY] === 'all_sessions' ? 'all_sessions' : 'main_only';
}

/** Engine-reported effective scope wins; stored values decide when the engine did not send one. */
export function toolScope(tool: Pick<ConfigurableTool, 'values' | 'sessionScope'>): SessionScopeChoice {
	if (tool.sessionScope === 'all_sessions' || tool.sessionScope === 'main_only') return tool.sessionScope;
	return scopeOf(tool.values);
}

/**
 * The scope toggle saves through the same PutConfigurableTool path as the form:
 * stored values are re-sent with only the scope key changed, so nothing is lost.
 */
export function scopeSaveInput(tool: ConfigurableTool, scope: SessionScopeChoice): PutConfigurableToolInput {
	return {
		name: tool.name,
		enabled: tool.status === 'active',
		values: {...tool.values, [SESSION_SCOPE_KEY]: scope}
	};
}

/** The regular form renders every field except the scope control, which lives on the tool row. */
export function formFields(tool: ConfigurableTool): ConfigurableToolField[] {
	return tool.fields.filter(field => field.key !== SESSION_SCOPE_KEY);
}
