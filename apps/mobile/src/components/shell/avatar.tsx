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
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import type { Mood } from '@/bridge/attention';
import { usePersona } from '@/bridge/use-persona';
import { useThemeVars } from '@/theme/theme-context';

const RING_WIDTH = 2;
const RING_GAP = 2.5;

/** A vector radial glow that feathers out smoothly on all platforms without CSS filter blur lags. */
export function AmbientGlow({
  size = 110,
  color = '#388bfd',
  opacity = 0.22
}: {
  size?: number;
  color?: string;
  opacity?: number;
}) {
  const r = size / 2;
  const id = `ambient-glow-${size}`;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      pointerEvents="none"
      style={{ position: 'absolute' }}
    >
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0%" stopColor={color} stopOpacity={opacity} />
          <Stop offset="50%" stopColor={color} stopOpacity={opacity * 0.35} />
          <Stop offset="100%" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={r} cy={r} r={r} fill={`url(#${id})`} />
    </Svg>
  );
}

/** The Fast brand medallion: a polished cosmic deep-blue tile with glowing kinetic bolt. */
export function FastMark({ size }: { size: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;
  const boltScale = size / 24;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <LinearGradient id={`fast-bg-${size}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#2563eb" stopOpacity="0.95" />
          <Stop offset="35%" stopColor="#0f2b5c" stopOpacity="0.98" />
          <Stop offset="100%" stopColor="#040a14" stopOpacity="1" />
        </LinearGradient>
        <LinearGradient id={`fast-bolt-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#ffffff" />
          <Stop offset="100%" stopColor="#e0f2fe" />
        </LinearGradient>
      </Defs>

      {/* Main disc */}
      <Circle cx={cx} cy={cy} r={r} fill={`url(#fast-bg-${size})`} />

      {/* Subtle top-light rim for crystal depth */}
      <Circle
        cx={cx}
        cy={cy}
        r={r - 0.75}
        stroke="rgba(255, 255, 255, 0.28)"
        strokeWidth={1}
        fill="none"
      />

      {/* Modern kinetic bolt */}
      <Path
        d="M13.5 2.5 4.8 12.8c-.4.5-.1 1.2.6 1.2h5.8l-1.6 7.5c-.3.7.6 1.2 1.1.6l8.7-10.3c.4-.5.1-1.2-.6-1.2h-5.8l1.6-7.5c.3-.7-.6-1.2-1.1-.6Z"
        fill={`url(#fast-bolt-${size})`}
        transform={`translate(${cx - 12 * boltScale}, ${cy - 12 * boltScale}) scale(${boltScale})`}
      />
    </Svg>
  );
}

/** The assistant's face. The ambient ring breathes softly only when working, solid when it needs you. */
export function Avatar({ size, mood = 'idle', badge = 0 }: { size: number; mood?: Mood; badge?: number }) {
  const vars = useThemeVars();
  const persona = usePersona();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);
  const breathing = mood === 'working' && !reduced;

  useEffect(() => {
    if (breathing) {
      pulse.value = withRepeat(
        withTiming(0.35, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
        -1,
        true
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = 1;
    }
  }, [breathing, pulse]);

  const ringStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const outer = size + (RING_WIDTH + RING_GAP) * 2;
  const isRingActive = mood === 'needs' || mood === 'working';
  const ringColor = mood === 'needs' ? vars['--warning'] : mood === 'working' ? vars['--focus'] : 'transparent';
  const custom = persona.mark.trim().length > 0;
  const isEmoji = custom && !/^[\p{L}\p{N}]/u.test(persona.mark);

  return (
    <View style={{ width: outer, height: outer }} className="items-center justify-center">
      {/* Outer ambient status ring */}
      {isRingActive ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: outer,
              height: outer,
              borderRadius: outer / 2,
              borderWidth: RING_WIDTH,
              borderColor: ringColor
            },
            ringStyle
          ]}
        />
      ) : null}

      {/* Main avatar core */}
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          shadowColor: '#388bfd',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: custom ? 0.05 : 0.28,
          shadowRadius: custom ? 2 : 6,
          elevation: custom ? 1 : 3
        }}
        className="items-center justify-center overflow-hidden"
      >
        {custom ? (
          <View
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: vars['--surface-secondary'],
              borderWidth: 1,
              borderColor: vars['--border']
            }}
            className="items-center justify-center"
          >
            <Text
              style={{ fontSize: isEmoji ? size * 0.5 : size * 0.42 }}
              className="font-semibold text-surface-secondary-foreground"
            >
              {persona.mark}
            </Text>
          </View>
        ) : (
          <FastMark size={size} />
        )}
      </View>

      {/* Decision / Actionable badge count */}
      {badge > 0 ? (
        <View
          style={{ minWidth: 18, height: 18, borderRadius: 9 }}
          className="absolute -right-0.5 -top-0.5 items-center justify-center bg-warning px-1 shadow-sm"
        >
          <Text className="text-[11px] font-bold text-warning-foreground">{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </View>
  );
}
