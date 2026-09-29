import { BlurView } from 'expo-blur';
import type { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glyph, type GlyphName } from '@/components/glyphs';
import { useKeyboardShown } from '@/components/use-keyboard';
import { useThemeMode, useThemeVars } from '@/theme/theme-context';
import { useAttention } from './use-attention';

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const BAR = 60;
const FLOAT_GAP = 8;
const ICONS: Record<string, GlyphName> = { index: 'chat', history: 'history', settings: 'settings' };

/** Room screens leave under the iOS floating bar; Android docks the bar in layout so needs none. */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return Platform.OS === 'ios' ? BAR + FLOAT_GAP + insets.bottom : 0;
}

/** Refined tab bar with crisp iconography and micro typography. */
export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const { scheme } = useThemeMode();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardShown();
  const { needsCount } = useAttention(null);
  const ios = Platform.OS === 'ios';
  if (keyboard) return null;

  const tabLabels: Record<string, string> = {
    index: t('mobile.tabs.chat'),
    history: t('mobile.tabs.history'),
    settings: t('mobile.tabs.settings')
  };

  const items = state.routes.map((route, index) => {
    const focused = state.index === index;
    const label = tabLabels[route.name] ?? descriptors[route.key]?.options.title ?? route.name;
    const badge = route.name === 'index' ? needsCount : 0;
    const press = () => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
    };
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected: focused }}
        onPress={press}
        className="flex-1 items-center justify-center gap-0.5 active:opacity-70"
        style={{ height: BAR }}
      >
        <View className="items-center">
          <Glyph
            name={ICONS[route.name] ?? 'chat'}
            size={22}
            color={focused ? vars['--focus'] : vars['--muted']}
            filled={focused}
          />
          {badge > 0 ? (
            <View
              style={{ minWidth: 16, height: 16, borderRadius: 8 }}
              className="absolute -right-2.5 -top-1 items-center justify-center bg-warning px-1 shadow-sm"
            >
              <Text className="text-[10px] font-bold leading-3 text-warning-foreground">
                {badge > 9 ? '9+' : badge}
              </Text>
            </View>
          ) : null}
        </View>
        <Text
          numberOfLines={1}
          style={{ color: focused ? vars['--focus'] : vars['--muted'] }}
          className={`text-[10px] ${focused ? 'font-semibold' : 'font-medium'}`}
        >
          {label}
        </Text>
      </Pressable>
    );
  });

  if (ios) {
    return (
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: 24, right: 24, bottom: insets.bottom + FLOAT_GAP }}
      >
        <View
          style={{
            height: BAR,
            borderRadius: BAR / 2,
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOpacity: scheme === 'dark' ? 0.42 : 0.12,
            shadowRadius: scheme === 'dark' ? 22 : 18,
            shadowOffset: { width: 0, height: 6 }
          }}
          className="border border-white/20 dark:border-white/15 dark:border-t-white/30"
        >
          <BlurView
            intensity={75}
            tint={scheme === 'dark' ? 'systemThickMaterialDark' : 'systemThickMaterialLight'}
            style={StyleSheet.absoluteFill}
          />
          <View className="flex-1 flex-row px-2">{items}</View>
        </View>
      </View>
    );
  }

  return (
    <View
      style={{
        paddingBottom: insets.bottom,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: vars['--separator'],
        backgroundColor: vars['--surface']
      }}
      className="flex-row shadow-sm"
    >
      {items}
    </View>
  );
}
