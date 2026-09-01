import {useEffect, useSyncExternalStore} from 'react';

import {bridgeStore} from './store';

export function useBridgeSnapshot() {
  return useSyncExternalStore(bridgeStore.subscribe, bridgeStore.getSnapshot);
}

let started = false;
export function useBridgeStart() {
  useEffect(() => {
    if (!started) {
      started = true;
      void bridgeStore.start();
    }
  }, []);
}
