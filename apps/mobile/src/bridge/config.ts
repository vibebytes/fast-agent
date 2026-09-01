import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { storageGet, storageRemove, storageSet } from './safe-storage';

export type SavedServer = {
  id: string;
  label: string;
  serverUrl: string;
  token: string;
  fingerprint?: string;
};

export type BridgeConfig = {
  servers: SavedServer[];
  activeServerId: string | null;
  clientId: string;
};

const KEY = 'bridge.config.v2';
const TOKEN_PREFIX = 'bridge.token.';

export const DEFAULT_SERVER_URL = 'ws://127.0.0.1:1979/bridge';

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
  const raw = await storageGet(KEY);
  const parsed = raw
    ? (JSON.parse(raw) as Partial<Omit<BridgeConfig, 'servers'> & { servers: (SavedServer & { token?: string })[] }>)
    : {};
  const servers: SavedServer[] = [];
  let migrated = false;
  for (const server of parsed.servers ?? []) {
    let token = '';
    if (server.token) {
      await writeToken(server.id, server.token);
      token = server.token;
      migrated = true;
    } else {
      token = await readToken(server.id);
    }
    servers.push({
      id: server.id,
      label: server.label,
      serverUrl: server.serverUrl,
      token,
      fingerprint: server.fingerprint
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
      fingerprint: server.fingerprint
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
};

export function toClientConfig(config: BridgeConfig): ClientConfig {
  const server = activeServer(config);
  return {
    serverUrl: server?.serverUrl ?? DEFAULT_SERVER_URL,
    token: server?.token ?? '',
    clientId: config.clientId,
    fingerprint: server?.fingerprint ?? null
  };
}
