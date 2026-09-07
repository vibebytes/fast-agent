import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { storageGet, storageRemove, storageSet } from './safe-storage';
import type { BridgeTrust } from './pairing';
import { inferTransport, type SavedServerTransport } from './saved-server';

export { inferTransport };
export type { SavedServerTransport };

export type SavedServer = {
  id: string;
  label: string;
  serverUrl: string;
  token: string;
  fingerprint?: string;
  transport: SavedServerTransport;
  trust: BridgeTrust;
  serverKey?: string;
  lastConnectedAt?: number;
};

export type BridgeConfig = {
  servers: SavedServer[];
  activeServerId: string | null;
  clientId: string;
};

const KEY = 'bridge.config.v3';
const LEGACY_KEY = 'bridge.config.v2';
const TOKEN_PREFIX = 'bridge.token.';

export const DEFAULT_SERVER_URL = 'wss://127.0.0.1:1979/bridge';

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newServerId(): string {
  return randomId();
}

function tokenKey(serverId: string): string {
  return TOKEN_PREFIX + serverId;
}

const useSecureStore = Platform.OS !== 'web';

async function readToken(serverId: string): Promise<string> {
  const key = tokenKey(serverId);
  if (!useSecureStore) return (await storageGet(key)) ?? '';
  return (await SecureStore.getItemAsync(key)) ?? '';
}

async function writeToken(serverId: string, token: string): Promise<void> {
  const key = tokenKey(serverId);
  if (!useSecureStore) {
    if (token) await storageSet(key, token);
    else await storageRemove(key);
    return;
  }
  if (token) {
    await SecureStore.setItemAsync(key, token);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}

export async function loadBridgeConfig(): Promise<BridgeConfig> {
  let raw = await storageGet(KEY);
  let migrated = false;
  if (!raw) {
    raw = await storageGet(LEGACY_KEY);
    migrated = Boolean(raw);
  }
  const parsed = raw
    ? (JSON.parse(raw) as Partial<Omit<BridgeConfig, 'servers'>> & {
        servers?: (Partial<SavedServer> & { token?: string })[];
      })
    : {};
  const servers: SavedServer[] = [];
  for (const server of parsed.servers ?? []) {
    if (!server.id || !server.serverUrl) continue;
    let token = '';
    if (server.token) {
      await writeToken(server.id, server.token);
      token = server.token;
      migrated = true;
    } else {
      token = await readToken(server.id);
    }
    const inferred = inferTransport(server.serverUrl);
    if (!server.transport || !server.trust) migrated = true;
    servers.push({
      id: server.id,
      label: server.label ?? server.serverUrl,
      serverUrl: server.serverUrl,
      token,
      fingerprint: server.fingerprint,
      transport: server.transport ?? inferred.transport,
      trust: server.trust ?? inferred.trust,
      serverKey: server.serverKey,
      lastConnectedAt: server.lastConnectedAt
    });
  }
  const config: BridgeConfig = {
    servers,
    activeServerId: parsed.activeServerId ?? null,
    clientId: parsed.clientId || randomId()
  };
  if (migrated) await saveBridgeConfig(config);
  return config;
}

export async function saveBridgeConfig(config: BridgeConfig): Promise<void> {
  await Promise.all(config.servers.map((server) => writeToken(server.id, server.token)));
  const stripped = {
    servers: config.servers.map((server) => ({
      id: server.id,
      label: server.label,
      serverUrl: server.serverUrl,
      fingerprint: server.fingerprint,
      transport: server.transport,
      trust: server.trust,
      serverKey: server.serverKey,
      lastConnectedAt: server.lastConnectedAt
    })),
    activeServerId: config.activeServerId,
    clientId: config.clientId
  };
  await storageSet(KEY, JSON.stringify(stripped));
}

export function activeServer(config: BridgeConfig): SavedServer | null {
  return config.servers.find((s) => s.id === config.activeServerId) ?? null;
}

export type ClientConfig = {
  serverUrl: string;
  token: string;
  clientId: string;
  fingerprint: string | null;
  trust: BridgeTrust;
};

export function toClientConfig(config: BridgeConfig): ClientConfig {
  const server = activeServer(config);
  return {
    serverUrl: server?.serverUrl ?? DEFAULT_SERVER_URL,
    token: server?.token ?? '',
    clientId: config.clientId,
    fingerprint: server?.fingerprint ?? null,
    trust: server?.trust ?? 'pinned'
  };
}
