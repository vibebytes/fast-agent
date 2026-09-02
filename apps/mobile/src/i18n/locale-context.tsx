import { resolveLocale, type Locale, type LocalePref } from '@fast-ide/i18n/browser';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { I18nextProvider } from 'react-i18next';

import { i18n } from './setup';
import { loadLocalePref, saveLocalePref, systemTag } from './locale';

const LocaleContext = createContext<{
  localePref: LocalePref;
  locale: Locale;
  setLocalePref: (pref: LocalePref) => void;
}>({
  localePref: 'system',
  locale: resolveLocale('system', 'en'),
  setLocalePref: () => {}
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [localePref, setLocalePrefState] = useState<LocalePref>('system');
  const [locale, setLocale] = useState<Locale>(() => resolveLocale('system', systemTag()));

  const apply = useCallback((pref: LocalePref) => {
    const resolved = resolveLocale(pref, systemTag());
    setLocale(resolved);
    void i18n.changeLanguage(resolved);
  }, []);

  useEffect(() => {
    void loadLocalePref().then((pref) => {
      setLocalePrefState(pref);
      apply(pref);
    });
  }, [apply]);

  useEffect(() => {
    if (localePref !== 'system') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') apply('system');
    });
    return () => sub.remove();
  }, [localePref, apply]);

  const setLocalePref = (pref: LocalePref) => {
    setLocalePrefState(pref);
    void saveLocalePref(pref);
    apply(pref);
  };

  return (
    <LocaleContext.Provider value={{ localePref, locale, setLocalePref }}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </LocaleContext.Provider>
  );
}

export function useLocalePrefs() {
  return useContext(LocaleContext);
}
