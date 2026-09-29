import { BlurView } from 'expo-blur';
import type { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glyph, type GlyphName } from '@/components/glyphs';
import { useKeyboardShown } from '@/components/use-keyboard';
import { useThemeMode, useThemeVars } from '@/theme/theme-context';
import { useAttention } from './use-attention';

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const BAR = 56;
const FLOAT_GAP = 8;
const ICONS: Record<string, GlyphName> = { index: 'chat', history: 'history', settings: 'settings' };

/** Room screens leave under the iOS floating bar; Android docks the bar in layout so needs none. */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return Platform.OS === 'ios' ? BAR + FLOAT_GAP + insets.bottom : 0;
}

/** iOS: floating glass capsule. Android: opaque docked bar. Icons only, labels kept for accessibility. */
export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const vars = useThemeVars();
  const { scheme } = useThemeMode();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardShown();
  const { needsCount } = useAttention(null);
  const ios = Platform.OS === 'ios';
  if (keyboard) return null;

  const items = state.routes.map((route, index) => {
    const focused = state.index === index;
    const label = descriptors[route.key]?.options.title ?? route.name;
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
        className="flex-1 items-center justify-center"
        style={{ height: BAR }}
      >
        <View>
          <Glyph
            name={ICONS[route.name] ?? 'chat'}
            size={25}
            color={focused ? vars['--foreground'] : vars['--muted']}
            filled={focused}
          />
          {badge > 0 ? (
            <View
              style={{ minWidth: 16, height: 16, borderRadius: 8 }}
              className="absolute -right-2 -top-1 items-center justify-center bg-warning px-1"
            >
              <Text className="text-[11px] font-semibold leading-4 text-warning-foreground">
                {badge > 9 ? '9+' : badge}
              </Text>
            </View>
          ) : null}
        </View>
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
            shadowColor: vars['--foreground'],
            shadowOpacity: 0.1,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 4 }
          }}
        >
          <BlurView
            intensity={72}
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
      className="flex-row"
    >
      {items}
    </View>
  );
}
