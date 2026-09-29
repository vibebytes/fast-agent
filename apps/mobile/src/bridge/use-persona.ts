import {useEffect, useSyncExternalStore} from 'react';

import {storageGet, storageSet} from './safe-storage';

const PERSONA_KEY = 'fast.mobile.persona';

/** The assistant's face on this phone. `mark` is an emoji or short text; empty means the brand bolt. */
export type Persona = {name: string; mark: string};

export const DEFAULT_PERSONA: Persona = {name: 'Fast', mark: ''};

let persona: Persona = DEFAULT_PERSONA;
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(): Promise<void> {
  loaded ??= storageGet(PERSONA_KEY).then((raw) => {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<Persona>;
      persona = {
        name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : DEFAULT_PERSONA.name,
        mark: typeof parsed.mark === 'string' ? parsed.mark.trim() : ''
      };
      listeners.forEach((l) => l());
    } catch (error) {
      console.warn('[persona] dropping unreadable persona', error);
    }
  });
  return loaded;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function savePersona(next: Persona): void {
  persona = {name: next.name.trim() || DEFAULT_PERSONA.name, mark: next.mark.trim()};
  void storageSet(PERSONA_KEY, JSON.stringify(persona));
  listeners.forEach((l) => l());
}

export function usePersona(): Persona {
  useEffect(() => {
    void load();
  }, []);
  return useSyncExternalStore(subscribe, () => persona);
}
