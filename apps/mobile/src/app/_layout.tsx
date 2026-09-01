import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { HeroUINativeProvider } from 'heroui-native/provider';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '../global.css';
import AppTabs from '@/components/app-tabs';
import { ensureVoiceEngine } from '@/lib/voice-engine';
import { FastThemeScope, ThemeModeProvider } from '@/theme/theme-context';

SplashScreen.preventAutoHideAsync();
void ensureVoiceEngine().catch(() => {});

export default function TabLayout() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <ThemeModeProvider>
          <FastThemeScope>
            <AppTabs />
          </FastThemeScope>
        </ThemeModeProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
