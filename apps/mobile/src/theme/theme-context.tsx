import { createContext, useContext, useEffect, useState } from 'react';
import { ScopedVariables } from 'uniwind';
import { useColorScheme } from 'react-native';

import { storageGet, storageSet } from '@/bridge/safe-storage';
import { PALETTES } from './palettes';
import { fastDark, fastLight } from './tokens';

export type ThemeMode = 'system' | 'light' | 'dark';

const MODE_KEY = 'fast.theme.mode';
const PALETTE_KEY = 'fast.theme.palette';

const ThemeModeContext = createContext<{
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  paletteId: string;
  setPaletteId: (id: string) => void;
  scheme: 'light' | 'dark';
}>({ mode: 'system', setMode: () => {}, paletteId: 'fast', setPaletteId: () => {}, scheme: 'light' });

export function ThemeModeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [paletteId, setPaletteIdState] = useState('fast');

  useEffect(() => {
    void storageGet(MODE_KEY).then((raw) => {
      if (raw === 'light' || raw === 'dark') setModeState(raw);
    });
    void storageGet(PALETTE_KEY).then((raw) => {
      if (raw && PALETTES.some((p) => p.id === raw)) setPaletteIdState(raw);
    });
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    void storageSet(MODE_KEY, next);
  };

  const setPaletteId = (next: string) => {
    setPaletteIdState(next);
    void storageSet(PALETTE_KEY, next);
  };

  const scheme = mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;

  return (
    <ThemeModeContext.Provider value={{ mode, setMode, paletteId, setPaletteId, scheme }}>
      {children}
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode() {
  return useContext(ThemeModeContext);
}

export function themeVars(scheme: 'light' | 'dark', paletteId: string): Record<string, string> {
  const palette = PALETTES.find((p) => p.id === paletteId) ?? PALETTES[0];
  const fallback = scheme === 'dark' ? fastDark : fastLight;
  return { ...fallback, ...(scheme === 'dark' ? palette.dark : palette.light) };
}

export function useThemeVars(): Record<string, string> {
  const { scheme, paletteId } = useThemeMode();
  return themeVars(scheme, paletteId);
}

export function FastThemeScope({ children }: { children: React.ReactNode }) {
  const { scheme, paletteId } = useThemeMode();
  return <ScopedVariables variables={themeVars(scheme, paletteId)}>{children}</ScopedVariables>;
}
