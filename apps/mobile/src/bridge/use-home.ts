import {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {activeHome, getActiveAgent, homeStep, parseHomes, pinIndividual, withHome, withoutHome, type Homes} from './home';
import {storageGet, storageSet} from './safe-storage';
import {bridgeStore} from './store';
import {useBridgeSnapshot} from './useBridge';

const HOMES_KEY = 'fast.mobile.homes';

export type HomeStatus = 'waiting' | 'creating' | 'failed' | 'ready';

let cache: Homes | null = null;
/** Homes created in this app run: a listing that raced ahead of the create must not read as a deletion. */
const fresh = new Set<string>();

async function loadHomes(): Promise<Homes> {
  if (!cache) cache = parseHomes(await storageGet(HOMES_KEY));
  return cache;
}

const homeListeners = new Set<(homes: Homes) => void>();

function saveHomes(next: Homes): void {
  cache = next;
  void storageSet(HOMES_KEY, JSON.stringify(next));
  homeListeners.forEach((listener) => listener(next));
}

/** Persist the selected individual's main session and tell the home tab to open it. */
export async function pinIndividualHome(pick: {
  serverId: string;
  projectId: string;
  agentId: string;
  mainSessionId: string;
}): Promise<void> {
  const homes = await loadHomes();
  saveHomes(pinIndividual(homes, pick));
}

/** Home session ids for every saved server, for places that only need to tell home apart. */
export function useHomeIds(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set(Object.values(cache ?? {}).map((h) => h.sessionId)));
  const snapshot = useBridgeSnapshot();
  useEffect(() => {
    void loadHomes().then((homes) => setIds(new Set(Object.values(homes).map((h) => h.sessionId))));
  }, [snapshot.sessionsByProject]);
  return ids;
}

/** Resolves (and when needed creates) the pinned main conversation for the active server. */
export function useHome(): {sessionId: string | null; status: HomeStatus; retry: () => void} {
  const {t} = useTranslation();
  const snapshot = useBridgeSnapshot();
  const serverId = bridgeStore.getConfig()?.activeServerId ?? null;
  const [homes, setHomes] = useState<Homes | null>(cache);
  const [failed, setFailed] = useState(false);
  const creating = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!homes) void loadHomes().then(setHomes);
  }, [homes]);

  useEffect(() => {
    const onHomes = (next: Homes) => setHomes(next);
    homeListeners.add(onHomes);
    return () => {
      homeListeners.delete(onHomes);
    };
  }, []);

  const home = serverId && homes ? activeHome(homes, serverId, getActiveAgent()) : undefined;
  const step =
    serverId && homes
      ? homeStep(home, {
          connected: snapshot.connection === 'open',
          projectId: snapshot.projectId,
          projectIds: snapshot.sessionsLoaded ? snapshot.projects.map((p) => p.id) : null,
          listed:
            home && !fresh.has(home.sessionId)
              ? snapshot.sessionsByProject[home.projectId]?.map((s) => s.id)
              : undefined
        })
      : ({kind: 'wait'} as const);

  useEffect(() => {
    if (step.kind !== 'create' || !serverId || !homes || failed || creating.current) return;
    creating.current = true;
    setBusy(true);
    const base = home ? withoutHome(homes, serverId) : homes;
    void bridgeStore.createSession(t('mobile.home.title')).then((sessionId) => {
      creating.current = false;
      setBusy(false);
      if (!sessionId) {
        console.warn('[home] creating the main conversation failed');
        setFailed(true);
        return;
      }
      fresh.add(sessionId);
      const next = withHome(base, {serverId, projectId: step.projectId, sessionId});
      saveHomes(next);
      setHomes(next);
    });
  }, [step.kind, step.kind === 'create' ? step.projectId : null, serverId, homes, home, failed, t]);

  const sessionId = step.kind === 'attach' ? step.sessionId : null;
  useEffect(() => {
    if (!sessionId) return;
    bridgeStore.attach(sessionId);
    return () => bridgeStore.detach(sessionId);
  }, [sessionId]);

  const retry = useCallback(() => setFailed(false), []);
  const status: HomeStatus = sessionId ? 'ready' : failed ? 'failed' : busy ? 'creating' : 'waiting';
  return {sessionId, status, retry};
}
