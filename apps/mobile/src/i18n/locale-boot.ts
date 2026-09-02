import { resolveLocale, type Locale, type LocalePref } from '@fast-ide/i18n/browser';
import type { i18n } from 'i18next';

/** System language is only live after the saved pref is read. */
export function canFollowSystem(hydrated: boolean, pref: LocalePref): boolean {
  return hydrated && pref === 'system';
}

export function whenI18nReady(instance: i18n): Promise<void> {
  if (instance.isInitialized) return Promise.resolve();
  return new Promise((resolve) => {
    if (instance.isInitialized) {
      resolve();
      return;
    }
    instance.on('initialized', () => resolve());
  });
}

export async function applyLocale(
  instance: i18n,
  pref: LocalePref,
  systemTag: string
): Promise<Locale> {
  await whenI18nReady(instance);
  const resolved = resolveLocale(pref, systemTag);
  await instance.changeLanguage(resolved);
  return resolved;
}
