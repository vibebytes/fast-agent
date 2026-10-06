/** Desktop's local individual, not whichever engine last marked `self`. */
export type RosterSelf = {
	id?: string;
	agentId?: string;
	self?: boolean;
};

export function rosterId(row: RosterSelf): string | undefined {
	return row.agentId || row.id;
}

export function pinLocalSelf<T extends RosterSelf>(items: T[], localAgentId?: string): T[] {
	if (!localAgentId) return items;
	return items.map(row => ({...row, self: rosterId(row) === localAgentId}));
}

export function rememberLocalId(items: RosterSelf[], current?: string): string | undefined {
	const mine = items.find(row => row.self);
	return (mine ? rosterId(mine) : undefined) || current;
}
