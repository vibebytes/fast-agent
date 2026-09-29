import { useRef, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glyph } from '@/components/glyphs';
import { lightImpact } from '@/lib/haptics';
import { FastThemeScope, useThemeVars } from '@/theme/theme-context';

/** Half-height sheet: native modal with backdrop, pull handle, and scrollable content. */
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
  const insets = useSafeAreaInsets();

  const handleClose = () => {
    lightImpact();
    onClose();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 5,
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 45 || gesture.vy > 0.5) {
          handleClose();
        }
      }
    })
  ).current;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <FastThemeScope>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-end"
        >
          {/* Dimmed Backdrop */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handleClose}
            className="bg-black/50"
            accessibilityRole="button"
            accessibilityLabel="Close sheet"
          />

          {/* Elevated Bottom Sheet Surface */}
          <View
            style={{
              maxHeight: '85%',
              backgroundColor: vars['--overlay'] || vars['--surface'],
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: vars['--border']
            }}
            className="shadow-2xl"
          >
            {/* Grab Handle & Header (Swipe down to dismiss) */}
            <View {...panResponder.panHandlers}>
              <View className="items-center pt-2.5 pb-1">
                <View className="h-1 w-9 rounded-full bg-foreground/20" />
              </View>

              <View className="flex-row items-center justify-between px-5 pb-3 pt-1">
                <Text numberOfLines={1} className="flex-1 text-[17px] font-semibold text-foreground">
                  {title}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onPress={handleClose}
                  hitSlop={8}
                  className="h-8 w-8 items-center justify-center rounded-full bg-surface-secondary active:opacity-60"
                >
                  <Glyph name="cross" size={13} color={vars['--muted']} />
                </Pressable>
              </View>
            </View>

            <View style={{ height: StyleSheet.hairlineWidth }} className="bg-separator" />

            {/* Scrollable Content */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingTop: 12,
                paddingBottom: Math.max(insets.bottom, 16) + 16
              }}
            >
              {children}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </FastThemeScope>
    </Modal>
  );
}

export { Hairline, SectionLabel } from './sheet-parts';
