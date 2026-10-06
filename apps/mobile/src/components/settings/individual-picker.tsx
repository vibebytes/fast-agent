import { Pressable, Text, View } from 'react-native';

import { pickerBlocked, pickerNote, type RosterItem } from '@/bridge/roster';

/** Lists individuals. The parent probes the certificate and pins the main session. */
export function IndividualPicker({
  items,
  onPick
}: {
  items: RosterItem[];
  open?: (url: string) => boolean;
  onPick: (item: RosterItem) => void;
}) {
  return (
    <View>
      {items.map(item => {
        const blocked = pickerBlocked(item);
        const note = pickerNote(item);
        return (
          <Pressable key={item.agentId} disabled={blocked} onPress={() => onPick(item)}>
            <Text>
              {item.displayName} · {item.presence}
              {note ? ` · ${note}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
