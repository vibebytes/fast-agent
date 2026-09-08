import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function GlassHeader({
  children,
  className,
  fallbackClassName = 'bg-background',
  style
}: {
  children: ReactNode;
  className?: string;
  fallbackClassName?: string;
  style?: StyleProp<ViewStyle>;
}) {
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView glassEffectStyle="regular" className={className} style={style}>
        {children}
      </GlassView>
    );
  }
  return (
    <View className={[className, fallbackClassName].filter(Boolean).join(' ')} style={style}>
      {children}
    </View>
  );
}

export function ScreenHeader({
  banner,
  className,
  children
}: {
  banner?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View className="bg-background" style={{ paddingTop: insets.top }}>
      {banner}
      <GlassHeader className={className}>{children}</GlassHeader>
    </View>
  );
}
