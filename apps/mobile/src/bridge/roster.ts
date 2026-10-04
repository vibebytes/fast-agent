/** Roster row the phone keeps. `hostedBy` never arrives from the bridge. */
export type RosterItem = {
  agentId: string;
  displayName: string;
  endpoints: string[];
  fingerprint: string;
  token?: string;
  presence: string;
  mainSessionId?: string;
  reachable?: boolean | 'unknown';
};

export type ConnectTarget = {url: string; fingerprint: string; agentId: string; label: string};

type ServerRosterRow = {
  id?: string;
  agentId?: string;
  displayName?: string;
  endpoints?: string[];
  fingerprint?: string;
  token?: string;
  presence?: string;
  mainSessionId?: string;
};

/** Bridge `ListRoster` uses `id`. The phone addresses an individual by `agentId`. */
export function fromServerRoster(body: unknown): RosterItem[] {
  if (!body || typeof body !== 'object' || !('items' in body)) return [];
  const items = (body as {items?: unknown}).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((raw) => {
    const row = raw as ServerRosterRow;
    const agentId = row.agentId || row.id || '';
    if (!agentId) return [];
    const endpoints = Array.isArray(row.endpoints) ? row.endpoints.filter((url) => typeof url === 'string' && url.length > 0) : [];
    return [
      {
        agentId,
        displayName: row.displayName || agentId,
        endpoints,
        fingerprint: row.fingerprint || '',
        token: row.token || '',
        presence: row.presence || '',
        mainSessionId: row.mainSessionId
      }
    ];
  });
}

/** Try open endpoints in order. A certificate that does not match the roster is a refusal. */
export async function connectChecked(
  item: RosterItem,
  open: (url: string) => boolean,
  probe: (url: string) => Promise<string | null>
): Promise<ConnectTarget | {error: string}> {
  const candidates = item.endpoints.filter(url => url.startsWith('wss://') && open(url));
  if (candidates.length === 0) return {error: '不可连接'};
  let sawCertificate = false;
  for (const url of candidates) {
    const presented = await probe(url);
    if (!presented) continue;
    sawCertificate = true;
    if (!trustFingerprint(item.fingerprint, presented)) return {error: '指纹不符'};
    return {url, fingerprint: presented, agentId: item.agentId, label: item.displayName};
  }
  return {error: sawCertificate ? '指纹不符' : '未能核对证书'};
}

export type CachedRoster = {items: RosterItem[]; sourceId: string | null};

export function reachable(item: RosterItem, open: (url: string) => boolean): boolean {
  return item.endpoints.some(url => url.startsWith('wss://') && open(url));
}

export function trustFingerprint(expected: string, presented: string): boolean {
  return expected.length > 0 && expected === presented;
}

/** Keep the last roster and switch the subscription to another live connection. */
export function switchSource(cache: CachedRoster, dead: string, live: string[]): CachedRoster {
  if (cache.sourceId !== dead) return cache;
  const next = live.find(id => id !== dead) ?? null;
  return {...cache, sourceId: next};
}

export function persistRoster(cache: CachedRoster): string {
  return JSON.stringify(cache);
}

export function loadRoster(raw: string | null): CachedRoster {
  if (!raw) return {items: [], sourceId: null};
  try {
    const parsed = JSON.parse(raw) as CachedRoster;
    if (!parsed || !Array.isArray(parsed.items)) return {items: [], sourceId: null};
    return {items: parsed.items, sourceId: parsed.sourceId ?? null};
  } catch {
    return {items: [], sourceId: null};
  }
}

/** Stale cache rows stay on screen with unknown reachability until a live source answers. */
export function expireReachability(cache: CachedRoster): CachedRoster {
  return {
    ...cache,
    items: cache.items.map(item => ({...item, reachable: 'unknown' as const}))
  };
}

/** ListRoster result or a pushed roster_changed snapshot. */
export function rosterFromEvent(event: {type: string; name?: string | null; value?: unknown; items?: unknown}): RosterItem[] | null {
  if (event.type === 'roster_changed') return fromServerRoster({items: event.items});
  if (event.type === 'command_result' && event.name === 'ListRoster') return fromServerRoster(event.value);
  return null;
}

/** Restart shows the last roster, with reachability cleared until a live probe. */
export function bootRoster(raw: string | null): CachedRoster {
  return expireReachability(loadRoster(raw));
}

/** The roster source dropped. Another live connection should be subscribed. */
export function loseSource(cache: CachedRoster, dead: string, live: string[]): {cache: CachedRoster; resubscribe: boolean} {
  const next = switchSource(cache, dead, live);
  return {cache: next, resubscribe: next.sourceId !== null && next.sourceId !== cache.sourceId};
}

function within(work: Promise<boolean>, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    work.then(
      ok => {
        clearTimeout(timer);
        resolve(ok);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      }
    );
  });
}

/** Probe each endpoint. A timeout or a false result marks the individual unreachable. */
export async function probeRoster(
  items: RosterItem[],
  open: (item: RosterItem, url: string) => Promise<boolean>,
  timeoutMs = 10000
): Promise<RosterItem[]> {
  return Promise.all(items.map(async item => {
    const urls = item.endpoints.filter(url => url.startsWith('wss://'));
    if (urls.length === 0) return {...item, reachable: false as const};
    const checks = await Promise.all(urls.map(url => within(open(item, url), timeoutMs)));
    return {...item, reachable: checks.some(Boolean)};
  }));
}

/** A failed probe, a missing endpoint, or a missing main session cannot be opened. */
export function pickerBlocked(item: RosterItem): boolean {
  if (item.reachable === false) return true;
  if (item.endpoints.length === 0) return true;
  if (!item.mainSessionId) return true;
  return false;
}
