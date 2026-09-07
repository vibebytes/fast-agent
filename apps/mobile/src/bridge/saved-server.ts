import type { BridgeTrust } from './pairing';
import type { SavedServer } from './config';

export type SavedServerTransport = 'lan' | 'tailscale' | 'cloudflare';

export type SaveServerInput = Omit<SavedServer, 'id'> & {id?: string};

/** Best-effort backfill for servers saved before transport/trust existed. Mislabeling is
 * harmless (badge only) — a successful connection heals it via saveServer. */
export function inferTransport(serverUrl: string): {transport: SavedServerTransport; trust: BridgeTrust} {
  try {
    const host = new URL(serverUrl.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:')).hostname;
    if (host.endsWith('.ts.net')) return {transport: 'tailscale', trust: 'pinned'};
    if (
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
      host === 'localhost' ||
      host.endsWith('.local') ||
      !host.includes('.')
    ) {
      return {transport: 'lan', trust: 'pinned'};
    }
    return {transport: 'cloudflare', trust: 'public'};
  } catch {
    return {transport: 'lan', trust: 'pinned'};
  }
}

export function upsertServer(
  servers: SavedServer[],
  input: SaveServerInput,
  newId: string
): {servers: SavedServer[]; id: string} {
  const byId = input.id ? servers.find((s) => s.id === input.id) : undefined;
  const byKey =
    !byId && input.serverKey
      ? servers.find((s) => s.serverKey && s.serverKey === input.serverKey)
      : undefined;
  // Legacy desktop QR (no serverKey): single-slot fallback so URL rotation cannot pile up dead entries.
  const legacySlot = !byId && !byKey && !input.serverKey && input.transport === 'cloudflare';
  const slot = legacySlot ? servers.find((s) => s.transport === 'cloudflare' && !s.serverKey) : undefined;
  const target = byId ?? byKey ?? slot;
  const id = target?.id ?? newId;
  const server: SavedServer = {
    id,
    label: byKey ? byKey.label : input.label,
    serverUrl: input.serverUrl,
    token: input.token,
    fingerprint: input.fingerprint,
    transport: input.transport,
    trust: input.trust,
    serverKey: input.serverKey ?? target?.serverKey,
    lastConnectedAt: target?.lastConnectedAt
  };
  let next = target ? servers.map((s) => (s.id === id ? server : s)) : [...servers, server];
  if (legacySlot) {
    // Never drop other desktops' keyed entries — only collapse unkeyed legacy ones.
    next = next.filter((s) => s.id === id || !(s.transport === 'cloudflare' && !s.serverKey));
  }
  return {servers: next, id};
}
