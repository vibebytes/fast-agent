/** Sync notify. A listener that writes again is coalesced into one extra flush. */
export function createNotify() {
  let flushing = false;
  let dirty = false;
  return (listeners: Set<() => void>) => {
    if (flushing) {
      dirty = true;
      return;
    }
    flushing = true;
    try {
      do {
        dirty = false;
        for (const listener of [...listeners]) listener();
      } while (dirty);
    } finally {
      flushing = false;
    }
  };
}
