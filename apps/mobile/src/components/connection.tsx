import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import type { ConnectionState } from '@/bridge/client';
import { formatCopy, type Translate } from '@/bridge/copy';
import type { BridgeConnUiState } from '@/bridge/store';
import { bridgeStore } from '@/bridge/store';
import { useBridgeSnapshot } from '@/bridge/useBridge';

export function connectionLabel(t: Translate, state: ConnectionState, ui?: BridgeConnUiState): string {
  if (ui === 'unconfigured') return t('mobile.conn.unconfigured');
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
  const label = connectionLabel(t, snapshot.connection, snapshot.connUi);
  const detail = snapshot.connectionDetail ? formatCopy(t, snapshot.connectionDetail) : '';
  const ui = snapshot.connUi;
  const uiLabel =
    ui === 'unconfigured'
      ? t('mobile.conn.unconfigured')
      : ui === 'authFailed'
      ? t('mobile.conn.authFailed')
      : ui === 'urlExpired'
        ? t('mobile.conn.urlExpired')
        : ui === 'reconnecting'
          ? t('mobile.conn.reconnecting')
          : ui === 'unreachable'
            ? t('mobile.conn.unreachable')
            : label;
  const rescanHint = ui === 'authFailed' || ui === 'urlExpired' ? t('mobile.conn.rescanHint') : '';
  return (
    <View className="bg-warning/15 px-3 py-1.5">
      <Pressable onPress={() => router.push('/settings')} className="min-h-11 justify-center">
        <Text className="text-center text-[11px] text-warning">
          {uiLabel}
          {rescanHint ? ` · ${rescanHint}` : detail ? ` · ${detail}` : ''}
        </Text>
      </Pressable>
      {snapshot.connection === 'rejected' ? (
        <Pressable onPress={() => bridgeStore.retry()} className="min-h-11 items-center justify-center">
          <Text className="text-xs font-semibold text-warning">{t('mobile.conn.retry')}</Text>
        </Pressable>
      ) : null}
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
