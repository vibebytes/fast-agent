/** The phone's pinned main conversation. The engine sees an ordinary session; only the phone treats it as home. */
export type Home = {serverId: string; projectId: string; sessionId: string};

/** One home per saved server, keyed by server id. */
export type Homes = Record<string, Home>;

export type HomeStep =
  | {kind: 'attach'; sessionId: string}
  | {kind: 'create'; projectId: string}
  | {kind: 'wait'};

export type HomeInput = {
  connected: boolean;
  /** Project a new home would be created in (the store's current project). */
  projectId: string | null;
  /** Known projects; `null` until `workspace_meta` has arrived. */
  projectIds: readonly string[] | null;
  /** Session ids listed under the home's project; `undefined` until that list is known. */
  listed: readonly string[] | undefined;
};

/** Attach the recorded home right away; recreate only once the listing proves it is gone. */
export function homeStep(home: Home | undefined, input: HomeInput): HomeStep {
  if (home && !isGone(home, input)) return {kind: 'attach', sessionId: home.sessionId};
  if (!input.connected || !input.projectId) return {kind: 'wait'};
  return {kind: 'create', projectId: input.projectId};
}

function isGone(home: Home, input: HomeInput): boolean {
  if (!input.projectIds) return false;
  if (!input.projectIds.includes(home.projectId)) return true;
  return input.listed !== undefined && !input.listed.includes(home.sessionId);
}

export function withHome(homes: Homes, home: Home): Homes {
  return {...homes, [home.serverId]: home};
}

export function withoutHome(homes: Homes, serverId: string): Homes {
  const {[serverId]: _dropped, ...rest} = homes;
  return rest;
}

export function parseHomes(raw: string | null): Homes {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, v]) => isHome(v))
    ) as Homes;
  } catch (error) {
    console.warn('[home] dropping unreadable home record', error);
    return {};
  }
}

function isHome(v: unknown): v is Home {
  if (typeof v !== 'object' || v === null) return false;
  const h = v as Record<string, unknown>;
  return typeof h.serverId === 'string' && typeof h.projectId === 'string' && typeof h.sessionId === 'string';
}
