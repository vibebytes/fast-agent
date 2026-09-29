import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps
} from '@gorhom/bottom-sheet';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeVars } from '@/theme/theme-context';

const SNAPS = ['50%', '90%'];

/** Half-height sheet: drag down to close, timeline stays visible behind it. */
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
  const ref = useRef<BottomSheetModal>(null);
  const vars = useThemeVars();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) ref.current?.present();
    else ref.current?.dismiss();
  }, [visible]);

  const backdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.32} />
    ),
    []
  );

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={SNAPS}
      enableDynamicSizing={false}
      onDismiss={onClose}
      backdropComponent={backdrop}
      backgroundStyle={{ backgroundColor: vars['--overlay'], borderRadius: 24 }}
      handleIndicatorStyle={{ backgroundColor: vars['--border'], width: 36 }}
    >
      <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}>
        <Text className="pb-3 pt-1 text-[17px] font-semibold text-overlay-foreground">{title}</Text>
        {children}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

/** Section label inside a sheet or grouped list. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text className="pb-1.5 pt-5 text-[13px] text-muted">{children}</Text>;
}

/** Hairline between rows, indented to the text edge. */
export function Hairline() {
  return <View style={{ height: StyleSheet.hairlineWidth }} className="bg-separator" />;
}
