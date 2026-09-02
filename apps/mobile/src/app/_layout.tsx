import * as SplashScreen from 'expo-splash-screen';
import { HeroUINativeProvider } from 'heroui-native/provider';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '../global.css';
import AppTabs from '@/components/app-tabs';
import { LocaleProvider } from '@/i18n/locale-context';
import { ensureVoiceEngine } from '@/lib/voice-engine';
import { FastThemeScope, ThemeModeProvider } from '@/theme/theme-context';

SplashScreen.preventAutoHideAsync();
void ensureVoiceEngine().catch(() => {});

export default function TabLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <ThemeModeProvider>
          <LocaleProvider>
            <FastThemeScope>
              <AppTabs />
            </FastThemeScope>
          </LocaleProvider>
        </ThemeModeProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
