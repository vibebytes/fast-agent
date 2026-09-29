import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Section label inside a sheet or grouped list. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text className="pb-1.5 pt-5 text-[13px] text-muted">{children}</Text>;
}

/** Hairline between rows, indented to the text edge. */
export function Hairline() {
  return <View style={{ height: StyleSheet.hairlineWidth }} className="bg-separator" />;
}
