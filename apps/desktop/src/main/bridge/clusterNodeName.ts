const LOCAL_EDGE_ID = 'local';
const INDIVIDUAL_PREFIX = 'individual:';

export type ClusterNameCard = {
	self?: boolean;
	agentId?: string;
	id?: string;
	displayName?: string;
};

/** Status-bar label for the current cluster node, if this edge is one. */
export function clusterNodeName(
	edgeId: string | null | undefined,
	roster: readonly ClusterNameCard[]
): string | undefined {
	if (!edgeId) return undefined;
	if (edgeId === LOCAL_EDGE_ID) {
		const self = roster.find(item => item.self);
		return self?.displayName?.trim() || undefined;
	}
	if (!edgeId.startsWith(INDIVIDUAL_PREFIX)) return undefined;
	const agentId = edgeId.slice(INDIVIDUAL_PREFIX.length);
	const row = roster.find(item => (item.agentId ?? item.id) === agentId);
	return row?.displayName?.trim() || agentId || undefined;
}
