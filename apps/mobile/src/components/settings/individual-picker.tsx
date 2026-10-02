import { Pressable, Text, View } from 'react-native';

import { pickerBlocked, reachable, type RosterItem } from '@/bridge/roster';

/** Lists individuals. The parent probes the certificate and pins the main session. */
export function IndividualPicker({
  items,
  open,
  onPick
}: {
  items: RosterItem[];
  open: (url: string) => boolean;
  onPick: (item: RosterItem) => void;
}) {
  return (
    <View>
      {items.map(item => {
        const down = item.reachable === false || !reachable(item, open);
        const blocked = down || pickerBlocked(item);
        const note = down || item.endpoints.length === 0 ? '不可连接' : !item.mainSessionId ? '没有主会话' : '';
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
