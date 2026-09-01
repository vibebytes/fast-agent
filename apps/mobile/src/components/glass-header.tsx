import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { View } from 'react-native';

export function GlassHeader({ children, className }: { children: ReactNode; className?: string }) {
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView glassEffectStyle="regular" className={className}>
        {children}
      </GlassView>
    );
  }
  return <View className={`${className ?? ''} bg-surface-secondary`}>{children}</View>;
}
