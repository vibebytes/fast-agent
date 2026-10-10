import type {ConfigurableTool} from '@fast-ide/session-view';

export type ToolGroupKey = 'general' | 'image' | 'video' | 'speech' | 'other';

export const TOOL_GROUP_KEYS: readonly ToolGroupKey[] = ['general', 'image', 'video', 'speech', 'other'];

/** Tab order is fixed; an empty group keeps its tab with an empty state. */
export function groupForTool(tool: ConfigurableTool): ToolGroupKey {
	return TOOL_GROUP_KEYS.includes(tool.group as ToolGroupKey) ? (tool.group as ToolGroupKey) : 'other';
}

export type ToolGroupRow = {key: ToolGroupKey; tools: ConfigurableTool[]};

export function groupRows(tools: readonly ConfigurableTool[]): ToolGroupRow[] {
	return TOOL_GROUP_KEYS.map(key => ({key, tools: toolsInGroup(tools, key)}));
}

export function toolsInGroup(tools: readonly ConfigurableTool[], key: ToolGroupKey): ConfigurableTool[] {
	return tools.filter(tool => groupForTool(tool) === key);
}
