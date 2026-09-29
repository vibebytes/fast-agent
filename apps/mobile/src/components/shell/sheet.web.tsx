import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { FastThemeScope, useThemeVars } from '@/theme/theme-context';

export { Hairline, SectionLabel } from './sheet-parts';

/** Web has no bottom-sheet portal; a plain modal keeps every sheet reachable. */
export function Sheet({
  visible,
  onClose,
  title,
  children
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const vars = useThemeVars();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <FastThemeScope>
        <View className="flex-1 justify-end bg-black/60">
          <Pressable accessibilityLabel={title} className="flex-1" onPress={onClose} />
          <View
            style={{ backgroundColor: vars['--overlay'] }}
            className="max-h-[80%] rounded-t-3xl border-t border-border/60 px-4 pb-6 shadow-2xl dark:border-t-white/20"
          >
            <View className="items-center py-2">
              <View className="h-1 w-9 rounded-full bg-border" />
            </View>
            <ScrollView>
              <Text className="pb-3 pt-1 text-[17px] font-semibold text-overlay-foreground">{title}</Text>
              {children}
            </ScrollView>
          </View>
        </View>
      </FastThemeScope>
    </Modal>
  );
}
