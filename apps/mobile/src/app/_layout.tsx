import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { HeroUINativeProvider } from 'heroui-native/provider';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '../global.css';
import AppTabs from '@/components/app-tabs';
import { useBridgeStart } from '@/bridge/useBridge';
import { LocaleProvider } from '@/i18n/locale-context';
import { ensureVoiceEngine } from '@/lib/voice-engine';
import { FastThemeScope, ThemeModeProvider, useThemeMode } from '@/theme/theme-context';

SplashScreen.preventAutoHideAsync();
void ensureVoiceEngine().catch(() => {});

export default function TabLayout() {
  useBridgeStart();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <ThemeModeProvider>
          <LocaleProvider>
            <FastThemeScope>
              <AppStatusBar />
              <AppTabs />
            </FastThemeScope>
          </LocaleProvider>
        </ThemeModeProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}

function AppStatusBar() {
  const { scheme } = useThemeMode();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}
