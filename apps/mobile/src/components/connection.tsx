import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import type { ConnectionState } from '@/bridge/client';
import { formatCopy, type Translate } from '@/bridge/copy';
import { useBridgeSnapshot } from '@/bridge/useBridge';

export function connectionLabel(t: Translate, state: ConnectionState): string {
  return state === 'rejected'
    ? t('mobile.connection.rejectedAuth')
    : t(`mobile.connection.${state}`, { defaultValue: state });
}

export function ConnectionBanner() {
  const { t } = useTranslation();
  const snapshot = useBridgeSnapshot();
  const host = snapshot.hostNotice?.trim();
  const parseFailures = snapshot.parseStats.parseFailures;
  if (snapshot.connection === 'open') {
    if (!host && parseFailures === 0) return null;
    const text = host ?? t('errors.protocol.mismatch', {defaultValue: `Parse failures: ${parseFailures}`});
    return (
      <View className="bg-warning/15 px-3 py-1.5">
        <Text className="text-center text-[11px] text-warning">
          {text}
          {!host && parseFailures > 0 ? ` (${parseFailures})` : ''}
        </Text>
      </View>
    );
  }
  const label = connectionLabel(t, snapshot.connection);
  const detail = snapshot.connectionDetail ? formatCopy(t, snapshot.connectionDetail) : '';
  return (
    <View className="bg-warning/15 px-3 py-1.5">
      <Text className="text-center text-[11px] text-warning">
        {label}
        {detail ? ` · ${detail}` : ''}
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
