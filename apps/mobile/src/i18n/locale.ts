import { SUPPORTED, type LocalePref } from '@fast-ide/i18n/browser';
import * as Localization from 'expo-localization';

import { storageGet, storageSet } from '@/bridge/safe-storage';

export const LOCALE_PREF_KEY = 'fast.locale.pref';

const ALLOWED: readonly LocalePref[] = ['system', ...SUPPORTED];

export function readLocalePref(raw: string | null): LocalePref {
  if (raw && (ALLOWED as readonly string[]).includes(raw)) return raw as LocalePref;
  return 'system';
}

export function systemTag(): string {
  return Localization.getLocales()[0]?.languageTag ?? 'en';
}

export async function loadLocalePref(): Promise<LocalePref> {
  return readLocalePref(await storageGet(LOCALE_PREF_KEY));
}

export async function saveLocalePref(pref: LocalePref): Promise<void> {
  await storageSet(LOCALE_PREF_KEY, pref);
}
