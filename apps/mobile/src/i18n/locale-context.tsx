import { resolveLocale, type Locale, type LocalePref } from '@fast-ide/i18n/browser';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { I18nextProvider } from 'react-i18next';

import { applyLocale, canFollowSystem } from './locale-boot';
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
  const [ready, setReady] = useState(false);
  const prefRef = useRef<LocalePref>('system');
  const readyRef = useRef(false);

  const apply = useCallback((pref: LocalePref) => {
    void applyLocale(i18n, pref, systemTag()).then(setLocale);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadLocalePref().then((pref) => {
      if (cancelled) return;
      prefRef.current = pref;
      setLocalePrefState(pref);
      void applyLocale(i18n, pref, systemTag())
        .then((resolved) => {
          if (!cancelled) setLocale(resolved);
        })
        .finally(() => {
          if (cancelled) return;
          readyRef.current = true;
          setReady(true);
          void SplashScreen.hideAsync();
        });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (!canFollowSystem(readyRef.current, prefRef.current)) return;
      apply('system');
    });
    return () => sub.remove();
  }, [apply]);

  const setLocalePref = (pref: LocalePref) => {
    prefRef.current = pref;
    setLocalePrefState(pref);
    void saveLocalePref(pref);
    apply(pref);
  };

  if (!ready) return null;

  return (
    <LocaleContext.Provider value={{ localePref, locale, setLocalePref }}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </LocaleContext.Provider>
  );
}

export function useLocalePrefs() {
  return useContext(LocaleContext);
}
