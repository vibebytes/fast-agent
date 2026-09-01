import { Text, View } from 'react-native';

import { useBridgeSnapshot } from '@/bridge/useBridge';

const LABELS: Record<string, string> = {
  idle: '未连接',
  connecting: '连接中…',
  reconnecting: '重连中…',
  rejected: '认证被拒绝',
  closed: '连接已断开'
};

export function ConnectionBanner() {
  const snapshot = useBridgeSnapshot();
  if (snapshot.connection === 'open') return null;
  const label = LABELS[snapshot.connection] ?? snapshot.connection;
  return (
    <View className="bg-warning/15 px-3 py-1.5">
      <Text className="text-center text-[11px] text-warning">
        {label}
        {snapshot.connectionDetail ? ` · ${snapshot.connectionDetail}` : ''}
      </Text>
    </View>
  );
}

export function ConnectionDot() {
  const snapshot = useBridgeSnapshot();
  const color =
    snapshot.connection === 'open'
      ? 'bg-success'
      : snapshot.connection === 'rejected'
        ? 'bg-destructive'
        : 'bg-warning';
  return <View className={`h-2 w-2 rounded-full ${color}`} />;
}
