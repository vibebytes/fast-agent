import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

/** One pinned main conversation. Keyed by the individual's agent id, not by the edge. */
export type ClusterHome = {
	edgeId: string;
	agentId: string;
	projectId: string;
	sessionId: string;
};

export type ClusterHomes = Record<string, ClusterHome>;

export function clusterHomesPath(userData: string): string {
	return join(userData, 'cluster-homes.json');
}

export function pinClusterHome(homes: ClusterHomes, home: ClusterHome): ClusterHomes {
	return {...homes, [home.agentId]: home};
}

export function clusterHome(homes: ClusterHomes, agentId: string): ClusterHome | undefined {
	return homes[agentId];
}

export function parseClusterHomes(raw: string | null): ClusterHomes {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const homes: ClusterHomes = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (!value || typeof value !== 'object') continue;
			const row = value as Partial<ClusterHome>;
			if (!row.agentId || !row.sessionId || !row.edgeId || !row.projectId) continue;
			homes[key] = {
				edgeId: row.edgeId,
				agentId: row.agentId,
				projectId: row.projectId,
				sessionId: row.sessionId
			};
		}
		return homes;
	} catch {
		return {};
	}
}

export function loadClusterHomes(path: string): ClusterHomes {
	try {
		return parseClusterHomes(readFileSync(path, 'utf8'));
	} catch {
		return {};
	}
}

export function saveClusterHomes(path: string, homes: ClusterHomes): void {
	writeFileSync(path, JSON.stringify(homes), {mode: 0o600});
}
