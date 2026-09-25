import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { HeroUINativeProvider } from 'heroui-native/provider';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '../global.css';
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
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="session/[id]" options={{ headerShown: true }} />
              </Stack>
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
