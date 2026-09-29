import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { HeroUINativeProvider } from 'heroui-native/provider';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '../global.css';
import { useBridgeStart } from '@/bridge/useBridge';
import { LocaleProvider } from '@/i18n/locale-context';
import { ensureVoiceEngine } from '@/lib/voice-engine';
import { FastThemeScope, ThemeModeProvider, useThemeMode, useThemeVars } from '@/theme/theme-context';

SplashScreen.preventAutoHideAsync();
void ensureVoiceEngine().catch(() => {});

export default function TabLayout() {
  useBridgeStart();
  return (
    <GestureHandlerRootView style={{ flex: 1 }} className="bg-background">
      <HeroUINativeProvider>
        <ThemeModeProvider>
          <LocaleProvider>
            <FastThemeScope>
              <BottomSheetModalProvider>
                <AppStatusBar />
                <StackNav />
              </BottomSheetModalProvider>
            </FastThemeScope>
          </LocaleProvider>
        </ThemeModeProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}

function StackNav() {
  const vars = useThemeVars();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: vars['--background'] } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="session/[id]" options={{ headerShown: true }} />
    </Stack>
  );
}

function AppStatusBar() {
  const { scheme } = useThemeMode();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}
