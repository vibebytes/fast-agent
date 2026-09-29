import {useEffect, useSyncExternalStore} from 'react';

import {displayOf, parseDisplays, toggled, withDisplay, type Display, type Displays} from './display';
import {storageGet, storageSet} from './safe-storage';

const DISPLAYS_KEY = 'fast.mobile.displays';

let displays: Displays = {};
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(): Promise<void> {
  loaded ??= storageGet(DISPLAYS_KEY).then((raw) => {
    displays = {...parseDisplays(raw), ...displays};
    listeners.forEach((l) => l());
  });
  return loaded;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDisplay(sessionId: string, isHome: boolean): {display: Display; toggle: () => void} {
  useEffect(() => {
    void load();
  }, []);
  const current = useSyncExternalStore(subscribe, () => displays);
  const display = displayOf(current, sessionId, isHome);
  const toggle = () => {
    displays = withDisplay(displays, sessionId, toggled(display));
    void storageSet(DISPLAYS_KEY, JSON.stringify(displays));
    listeners.forEach((l) => l());
  };
  return {display, toggle};
}
