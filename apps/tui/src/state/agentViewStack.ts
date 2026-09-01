export type AgentViewEntry = {
	agentId: string;
	name: string;
	parentAgentId?: string;
	siblings: Array<{agentId: string; name: string}>;
};

export type AgentViewStack = {
	entries: AgentViewEntry[];
};

export const emptyViewStack: AgentViewStack = {entries: []};

export function viewDepth(stack: AgentViewStack): number {
	return stack.entries.length;
}

export function activeAgent(stack: AgentViewStack): AgentViewEntry | undefined {
	return stack.entries.at(-1);
}

export function breadcrumbs(stack: AgentViewStack): string[] {
	return stack.entries.map(e => e.name);
}

export function pushAgent(stack: AgentViewStack, entry: AgentViewEntry): AgentViewStack {
	return {entries: [...stack.entries, entry]};
}

export function popAgent(stack: AgentViewStack): AgentViewStack {
	if (stack.entries.length <= 0) return stack;
	return {entries: stack.entries.slice(0, -1)};
}

export function switchSibling(stack: AgentViewStack, direction: 'prev' | 'next'): AgentViewStack {
	const current = stack.entries.at(-1);
	if (!current || current.siblings.length <= 1) return stack;
	const idx = current.siblings.findIndex(s => s.agentId === current.agentId);
	if (idx < 0) return stack;
	const nextIdx = direction === 'next'
		? (idx + 1) % current.siblings.length
		: (idx - 1 + current.siblings.length) % current.siblings.length;
	const sibling = current.siblings[nextIdx];
	if (!sibling) return stack;
	return {
		entries: [
			...stack.entries.slice(0, -1),
			{...current, agentId: sibling.agentId, name: sibling.name}
		]
	};
}
