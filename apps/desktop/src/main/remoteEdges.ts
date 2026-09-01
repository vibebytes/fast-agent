import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {randomUUID} from 'node:crypto';

export const LOCAL_EDGE_ID = 'local';
export const EDGES_FILE = 'remote-edges.json';
export const CONNECT_DEADLINE_MS = 8_000;

export type EdgeToken = {enc: string} | {plain: string};

export type RemoteEdge = {
	id: string;
	name: string;
	ip: string;
	port: number;
	token: EdgeToken;
	fingerprint?: string;
	caPem?: string;
	insecureSkipVerify?: boolean;
};

export type RemoteEdgesFile = {
	version: 1;
	activeId: string;
	servers: RemoteEdge[];
};

export type EdgeCapabilities = {
	canOpenLocalFolder: boolean;
	canCreateLocalProject: boolean;
	canOpenRemoteFolder: boolean;
};

export type EdgeInput = {
	id?: string;
	name: string;
	ip: string;
	port: number;
	token: string;
	fingerprint?: string;
	caPem?: string;
	insecureSkipVerify?: boolean;
};

export type TokenVault = {
	isEncryptionAvailable(): boolean;
	encryptString(plain: string): Buffer;
	decryptString(buf: Buffer): string;
};

export type EdgeValidate =
	| {ok: true}
	| {ok: false; message: string};

const HOST = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function tryNormalizeFingerprint(raw: string): string | undefined {
	const hex = raw.replace(/^sha256:/i, '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
	if (hex.length !== 64) return undefined;
	return `sha256:${hex}`;
}

export function isLoopbackHost(ip: string): boolean {
	const h = ip.trim().toLowerCase();
	return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

/** Remote hosts speak TLS. Loopback stays plaintext, same as the daemon debug listen. */
export function edgeUrl(ip: string, port: number): string {
	const scheme = isLoopbackHost(ip) ? 'ws' : 'wss';
	return `${scheme}://${ip}:${port}/bridge`;
}

export function edgeCapabilities(
	activeId: string,
	pendingEdgeId?: string | null
): EdgeCapabilities {
	const remote = activeId !== LOCAL_EDGE_ID;
	const pending = Boolean(pendingEdgeId);
	return {
		canOpenLocalFolder: !remote,
		canCreateLocalProject: !remote,
		canOpenRemoteFolder: remote && !pending
	};
}

export function validateEdgeInput(input: EdgeInput): EdgeValidate {
	const name = input.name.trim();
	const ip = input.ip.trim();
	const token = input.token.trim();
	if (!name) return {ok: false, message: 'Name is required'};
	if (!ip) return {ok: false, message: 'Host is required'};
	if (ip.includes(':') && !IPV4.test(ip)) return {ok: false, message: 'IPv6 is not supported'};
	if (!IPV4.test(ip) && !HOST.test(ip)) return {ok: false, message: 'Invalid host'};
	if (IPV4.test(ip) && ip.split('.').some(p => Number(p) > 255)) {
		return {ok: false, message: 'Invalid host'};
	}
	if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
		return {ok: false, message: 'Port must be 1–65535'};
	}
	if (!token) return {ok: false, message: 'Token is required'};
	if (input.fingerprint && !tryNormalizeFingerprint(input.fingerprint)) {
		return {ok: false, message: 'Invalid certificate fingerprint'};
	}
	return {ok: true};
}

export function emptyEdgesFile(): RemoteEdgesFile {
	return {version: 1, activeId: LOCAL_EDGE_ID, servers: []};
}

export function parseEdgesFile(raw: unknown): RemoteEdgesFile {
	if (!raw || typeof raw !== 'object') return emptyEdgesFile();
	const rec = raw as Record<string, unknown>;
	const servers = Array.isArray(rec.servers)
		? rec.servers.flatMap(row => {
				const parsed = parseServerRow(row);
				return parsed ? [parsed] : [];
			})
		: [];
	const activeId =
		typeof rec.activeId === 'string' &&
		(rec.activeId === LOCAL_EDGE_ID || servers.some(s => s.id === rec.activeId))
			? rec.activeId
			: LOCAL_EDGE_ID;
	return {version: 1, activeId, servers};
}

function parseServerRow(row: unknown): RemoteEdge | null {
	if (!row || typeof row !== 'object') return null;
	const rec = row as Record<string, unknown>;
	if (typeof rec.id !== 'string' || !rec.id.trim()) return null;
	if (typeof rec.name !== 'string' || !rec.name.trim()) return null;
	if (typeof rec.ip !== 'string' || !rec.ip.trim()) return null;
	if (typeof rec.port !== 'number' || !Number.isInteger(rec.port)) return null;
	const token = parseToken(rec.token);
	if (!token) return null;
	const edge: RemoteEdge = {
		id: rec.id.trim(),
		name: rec.name.trim(),
		ip: rec.ip.trim(),
		port: rec.port,
		token
	};
	if (typeof rec.fingerprint === 'string') {
		const pin = tryNormalizeFingerprint(rec.fingerprint);
		if (pin) edge.fingerprint = pin;
	}
	if (typeof rec.caPem === 'string' && rec.caPem.trim()) edge.caPem = rec.caPem;
	if (rec.insecureSkipVerify === true) edge.insecureSkipVerify = true;
	return edge;
}

function parseToken(raw: unknown): EdgeToken | null {
	if (!raw || typeof raw !== 'object') return null;
	const rec = raw as Record<string, unknown>;
	if (typeof rec.enc === 'string' && rec.enc) return {enc: rec.enc};
	if (typeof rec.plain === 'string' && rec.plain) return {plain: rec.plain};
	return null;
}

export function sealToken(plain: string, vault?: TokenVault | null): EdgeToken {
	if (vault?.isEncryptionAvailable()) {
		return {enc: vault.encryptString(plain).toString('base64')};
	}
	return {plain};
}

export function openToken(token: EdgeToken, vault?: TokenVault | null): string {
	if ('plain' in token) return token.plain.trim();
	if (!vault?.isEncryptionAvailable()) {
		throw new Error('Token is encrypted but safeStorage is unavailable');
	}
	return vault.decryptString(Buffer.from(token.enc, 'base64')).trim();
}

export function upsertServer(
	file: RemoteEdgesFile,
	input: EdgeInput,
	vault?: TokenVault | null
): {file: RemoteEdgesFile; id: string} {
	const check = validateEdgeInput(input);
	if (!check.ok) throw new Error(check.message);
	const id = input.id?.trim() || randomUUID();
	const next: RemoteEdge = {
		id,
		name: input.name.trim(),
		ip: input.ip.trim(),
		port: input.port,
		token: sealToken(input.token.trim(), vault)
	};
	const pin = input.fingerprint ? tryNormalizeFingerprint(input.fingerprint) : undefined;
	if (pin) next.fingerprint = pin;
	if (input.caPem?.trim() && !input.insecureSkipVerify) next.caPem = input.caPem.trim();
	if (input.insecureSkipVerify) next.insecureSkipVerify = true;
	const servers = file.servers.some(s => s.id === id)
		? file.servers.map(s => (s.id === id ? next : s))
		: [...file.servers, next];
	return {file: {...file, servers}, id};
}

export function deleteServer(
	file: RemoteEdgesFile,
	id: string
): RemoteEdgesFile {
	const servers = file.servers.filter(s => s.id !== id);
	const activeId = file.activeId === id ? LOCAL_EDGE_ID : file.activeId;
	return {...file, servers, activeId};
}

export function commitActiveId(file: RemoteEdgesFile, activeId: string): RemoteEdgesFile {
	if (activeId !== LOCAL_EDGE_ID && !file.servers.some(s => s.id === activeId)) {
		throw new Error(`Unknown edge: ${activeId}`);
	}
	return {...file, activeId};
}

export function publicServers(file: RemoteEdgesFile): Array<{
	id: string;
	name: string;
	ip: string;
	port: number;
}> {
	return file.servers.map(({id, name, ip, port}) => ({id, name, ip, port}));
}

export function remoteConnection(
	row: Pick<RemoteEdge, 'ip' | 'port' | 'token' | 'fingerprint' | 'caPem' | 'insecureSkipVerify'>,
	vault?: TokenVault | null
): {
	url: string;
	authToken: string;
	fingerprint?: string;
	caPem?: string;
	insecureSkipVerify?: boolean;
	timeoutMs: number;
} {
	return {
		url: edgeUrl(row.ip, row.port),
		authToken: openToken(row.token, vault),
		fingerprint: row.fingerprint,
		caPem: row.caPem,
		insecureSkipVerify: row.insecureSkipVerify,
		timeoutMs: CONNECT_DEADLINE_MS
	};
}

export function loadEdgesFile(path: string): RemoteEdgesFile {
	if (!existsSync(path)) return emptyEdgesFile();
	try {
		return parseEdgesFile(JSON.parse(readFileSync(path, 'utf8')));
	} catch (error) {
		console.error(`remote-edges.json unreadable: ${path}`, error);
		return emptyEdgesFile();
	}
}

export function saveEdgesFile(path: string, file: RemoteEdgesFile): void {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
	writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, {mode: 0o600});
	try {
		chmodSync(path, 0o600);
	} catch (error) {
		console.error(`could not set 0600 on ${path}`, error);
	}
}

export function edgesPath(userData: string): string {
	return join(userData, EDGES_FILE);
}
