import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import type { ConnectionState } from '@/bridge/client';
import { formatCopy, type Translate } from '@/bridge/copy';
import type { BridgeConnUiState } from '@/bridge/store';
import { bridgeStore } from '@/bridge/store';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { Glyph } from '@/components/glyphs';
import { useThemeVars } from '@/theme/theme-context';

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
      <Notice>
        {text}
        {!host && parseFailures > 0 ? ` (${parseFailures})` : ''}
      </Notice>
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
    <View className="flex-row items-center">
      <Pressable onPress={() => router.push('/settings')} className="flex-1 active:opacity-60">
        <Notice>
          {uiLabel}
          {rescanHint ? ` · ${rescanHint}` : detail ? ` · ${detail}` : ''}
        </Notice>
      </Pressable>
      {snapshot.connection === 'rejected' ? (
        <Pressable onPress={() => bridgeStore.retry()} className="min-h-11 justify-center px-4 active:opacity-60">
          <Text className="text-[13px] font-semibold text-link">{t('mobile.conn.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Connection trouble: a warning mark and one muted line, no colour band. */
function Notice({ children }: { children: ReactNode }) {
  const vars = useThemeVars();
  return (
    <View className="min-h-11 flex-row items-center gap-1.5 px-4 py-1.5">
      <Glyph name="alert" size={14} color={vars['--warning']} />
      <Text numberOfLines={2} className="flex-1 text-[13px] text-muted">
        {children}
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
        ? 'bg-danger'
        : 'bg-warning';
  return <View className={`h-2 w-2 rounded-full ${color}`} />;
}
