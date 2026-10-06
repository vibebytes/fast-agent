/** Same four states as desktop `clusterReach`. */
export type ClusterReach = 'open' | 'down' | 'mismatch' | 'no-main';

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
  reach?: ClusterReach;
  reachMessage?: string;
};

export type ConnectTarget = {url: string; fingerprint: string; agentId: string; label: string};

/** TLS inspect result for one URL. `true` = pin matches; `'mismatch'` ≠ down. */
export type RosterProbe = boolean | 'mismatch';

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
    items: cache.items.map(({reach: _reach, reachMessage: _message, ...item}) => ({
      ...item,
      reachable: 'unknown' as const
    }))
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

function within(work: Promise<RosterProbe>, timeoutMs: number): Promise<RosterProbe> {
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

function classified(item: RosterItem, reach: ClusterReach, message?: string): RosterItem {
  return {
    ...item,
    reach,
    reachMessage: message,
    reachable: reach === 'open' || reach === 'no-main'
  };
}

/** Probe each endpoint. Certificate mismatch is not the same as unreachable. */
export async function probeRoster(
  items: RosterItem[],
  open: (item: RosterItem, url: string) => Promise<RosterProbe>,
  timeoutMs = 10000
): Promise<RosterItem[]> {
  return Promise.all(items.map(async item => {
    const urls = item.endpoints.filter(url => url.startsWith('wss://'));
    if (urls.length === 0) return classified(item, 'down', '不可连接');
    const checks = await Promise.all(urls.map(url => within(open(item, url), timeoutMs)));
    if (checks.some(result => result === true)) {
      return item.mainSessionId
        ? classified(item, 'open')
        : classified(item, 'no-main', '没有主会话');
    }
    if (checks.some(result => result === 'mismatch')) return classified(item, 'mismatch', '指纹不符');
    return classified(item, 'down', '不可连接');
  }));
}

/** A failed probe, a missing endpoint, a pin mismatch, or a missing main session cannot be opened. */
export function pickerBlocked(item: RosterItem): boolean {
  if (item.reach === 'down' || item.reach === 'mismatch') return true;
  if (item.reachable === false) return true;
  if (item.endpoints.filter(url => url.startsWith('wss://')).length === 0) return true;
  if (!item.mainSessionId || item.reach === 'no-main') return true;
  return false;
}

export function pickerNote(item: RosterItem): string {
  if (item.reach === 'mismatch' || item.reachMessage === '指纹不符') return '指纹不符';
  if (item.reach === 'down' || item.reachable === false || item.endpoints.filter(url => url.startsWith('wss://')).length === 0) {
    return item.reachMessage || '不可连接';
  }
  if (!item.mainSessionId || item.reach === 'no-main') return '没有主会话';
  return item.reachMessage || '';
}

/** Direct-connect one roster row. Callers must not Hello / save when this returns an error. */
export async function openIndividual(
  item: RosterItem,
  deps: {
    open: (url: string) => boolean;
    probe: (url: string) => Promise<string | null>;
    save: (target: ConnectTarget) => Promise<boolean>;
    pin: (target: ConnectTarget, mainSessionId: string) => Promise<void>;
  }
): Promise<{ok: true} | {ok: false; error: string}> {
  if (item.reach === 'mismatch') return {ok: false, error: '指纹不符'};
  if (item.reach === 'down') return {ok: false, error: item.reachMessage || '不可连接'};
  const target = await connectChecked(item, deps.open, deps.probe);
  if ('error' in target) return {ok: false, error: target.error};
  if (!item.mainSessionId) return {ok: false, error: '没有主会话'};
  const saved = await deps.save(target);
  if (!saved) return {ok: false, error: '不可连接'};
  await deps.pin(target, item.mainSessionId);
  return {ok: true};
}
