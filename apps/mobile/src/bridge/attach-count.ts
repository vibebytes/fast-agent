export type AttachCounts = Record<string, number>;

export function attachOne(counts: AttachCounts, id: string): AttachCounts {
  return {...counts, [id]: (counts[id] ?? 0) + 1};
}

/** `release` is true only when the count actually falls to zero. */
export function detachOne(counts: AttachCounts, id: string): {counts: AttachCounts; release: boolean} {
  const prev = counts[id] ?? 0;
  if (prev <= 1) {
    if (prev === 0) return {counts, release: false};
    const next = {...counts};
    delete next[id];
    return {counts: next, release: true};
  }
  return {counts: {...counts, [id]: prev - 1}, release: false};
}
