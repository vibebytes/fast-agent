import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming
} from 'react-native-reanimated';

import type { Mood } from '@/bridge/attention';
import { usePersona } from '@/bridge/use-persona';
import { Glyph } from '@/components/glyphs';
import { useThemeVars } from '@/theme/theme-context';

const RING = 2;
const GAP = 2;

/** The assistant's face: a dark tile with the brand bolt (or the user's own mark) over a soft halo. Its ring is the app's only ambient motion: breathing while working, solid when it needs you. */
export function Avatar({ size, mood = 'idle', badge = 0 }: { size: number; mood?: Mood; badge?: number }) {
  const vars = useThemeVars();
  const persona = usePersona();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);
  const breathing = mood === 'working' && !reduced;

  useEffect(() => {
    if (breathing) {
      pulse.value = withRepeat(withTiming(0.3, { duration: 1200, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else {
      cancelAnimation(pulse);
      pulse.value = 1;
    }
  }, [breathing, pulse]);

  const ringStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const outer = size + (RING + GAP) * 2;
  const ringColor = mood === 'needs' ? vars['--warning'] : mood === 'working' ? vars['--focus'] : 'transparent';
  const custom = persona.mark.length > 0;
  const isEmoji = custom && !/^[\p{L}\p{N}]/u.test(persona.mark);

  return (
    <View style={{ width: outer, height: outer }} className="items-center justify-center">
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            width: outer,
            height: outer,
            borderRadius: outer / 2,
            borderWidth: RING,
            borderColor: ringColor
          },
          ringStyle
        ]}
      />
      <View
        pointerEvents="none"
        style={{ position: 'absolute', width: outer, height: outer, borderRadius: outer / 2, backgroundColor: vars['--focus'], opacity: 0.12 }}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: custom ? vars['--surface-secondary'] : vars['--foreground'],
          borderWidth: 1,
          borderColor: vars['--focus']
        }}
        className="items-center justify-center"
      >
        {custom ? (
          <Text
            style={{ fontSize: isEmoji ? size * 0.5 : size * 0.42 }}
            className="font-semibold text-surface-secondary-foreground"
          >
            {persona.mark}
          </Text>
        ) : (
          <Glyph name="bolt" size={size * 0.52} color={vars['--background']} filled />
        )}
      </View>
      {badge > 0 ? (
        <View
          style={{ minWidth: 18, height: 18, borderRadius: 9 }}
          className="absolute -right-0.5 -top-0.5 items-center justify-center bg-warning px-1"
        >
          <Text className="text-[11px] font-semibold text-warning-foreground">{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </View>
  );
}
