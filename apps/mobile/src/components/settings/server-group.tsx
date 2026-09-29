import { useTranslation } from 'react-i18next';
import { LayoutAnimation, Platform, Pressable, Text, UIManager, View } from 'react-native';

import type { SavedServer } from '@/bridge/config';
import { Glyph } from '@/components/glyphs';
import { Hairline } from '@/components/shell/sheet';
import { useThemeMode, useThemeVars } from '@/theme/theme-context';
import { BADGE_PALETTE, FieldRow, Group, Row } from './group';
import { FingerprintSheet, Scanner } from './pairing';
import { useServers } from './use-servers';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type T = ReturnType<typeof useTranslation>['t'];

function lastConnected(t: T, server: SavedServer): string {
  if (!server.lastConnectedAt) return t('mobile.settings.lastConnectedNever');
  const mins = Math.floor((Date.now() - server.lastConnectedAt) / 60000);
  if (mins < 1) return t('mobile.settings.lastConnectedNow');
  if (mins < 60) return t('mobile.settings.lastConnectedMinutes', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('mobile.settings.lastConnectedHours', { count: hours });
  return t('mobile.settings.lastConnectedDays', { count: Math.floor(hours / 24) });
}

export function ServerGroup() {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const { scheme } = useThemeMode();
  const isDark = scheme === 'dark';
  const s = useServers();
  const active = s.servers.find((x) => x.id === s.activeServerId);

  const toggleWithAnimation = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    s.toggleForm();
  };

  const statusBadge = (
    <View
      style={{
        backgroundColor: s.connected
          ? isDark
            ? 'rgba(34, 197, 94, 0.16)'
            : 'rgba(34, 197, 94, 0.12)'
          : isDark
            ? 'rgba(255, 255, 255, 0.08)'
            : 'rgba(100, 116, 139, 0.12)'
      }}
      className="flex-row items-center gap-1.5 rounded-full px-2.5 py-0.5"
    >
      <View
        style={{ backgroundColor: s.connected ? '#22c55e' : isDark ? '#94a3b8' : '#64748b' }}
        className="h-1.5 w-1.5 rounded-full"
      />
      <Text
        style={{ color: s.connected ? (isDark ? '#4ade80' : '#16a34a') : isDark ? '#94a3b8' : '#64748b' }}
        className="text-[11px] font-semibold tracking-wide"
      >
        {s.connected ? t('mobile.connection.open') : t('mobile.connection.idle')}
      </Text>
    </View>
  );

  return (
    <>
      <Group
        title={t('mobile.settings.bridge')}
        headerRight={statusBadge}
        footer={s.connected ? t('mobile.settings.syncReady') : undefined}
      >
        <Row
          label={t('mobile.settings.scanPair')}
          icon="qr"
          badge="green"
          detail={t('mobile.settings.scanHint')}
          chevron
          onPress={() => void s.openScanner()}
        />
        {s.servers.map((server) => (
          <ServerRow
            key={server.id}
            server={server}
            active={server.id === active?.id}
            editing={server.id === s.editingId}
            testing={s.testing}
            onOpen={() => void s.open(server)}
            onTest={() => void s.testServer(server)}
            onDelete={() => void s.remove(server.id)}
          />
        ))}

        <Row
          label={
            s.formOpen
              ? s.editingId
                ? t('mobile.settings.cancelEdit')
                : t('mobile.settings.collapseManual')
              : t('mobile.settings.addManual')
          }
          icon="link"
          badge="blue"
          chevron
          right={
            <Glyph
              name={s.formOpen ? 'chevron-down' : 'chevron-right'}
              size={14}
              color={vars['--muted']}
            />
          }
          onPress={toggleWithAnimation}
        />
      </Group>

      {s.formOpen ? (
        <Group title={s.editingId ? t('mobile.settings.editingServer') : undefined}>
          <FieldRow
            label={t('mobile.settings.fieldLabel')}
            value={s.draft.label}
            onChangeText={(label) => s.setDraft((d) => ({ ...d, label }))}
            placeholder={t('mobile.settings.labelPlaceholder')}
            autoCapitalize="sentences"
          />
          <FieldRow
            label={t('mobile.settings.fieldUrl')}
            mono
            value={s.draft.url}
            onChangeText={(url) => s.setDraft((d) => ({ ...d, url }))}
            placeholder="wss://…"
          />
          <FieldRow
            label="Token"
            mono
            value={s.draft.token}
            onChangeText={(token) => s.setDraft((d) => ({ ...d, token }))}
            placeholder={t('mobile.settings.tokenPlaceholder')}
          />
          <FieldRow
            label={t('mobile.settings.fieldFingerprint')}
            mono
            value={s.draft.fingerprint}
            onChangeText={(fingerprint) => s.setDraft((d) => ({ ...d, fingerprint }))}
            placeholder={t('mobile.settings.fingerprintPlaceholder')}
          />
          <View className="flex-row gap-3 p-3">
            <Pressable
              onPress={s.testing ? undefined : () => void s.testDraft()}
              disabled={s.testing}
              className="min-h-[44px] flex-1 items-center justify-center rounded-xl border border-border/80 dark:border-white/15 bg-surface-secondary active:opacity-70 disabled:opacity-50"
            >
              <Text className="text-[14px] font-semibold text-foreground">
                {s.testing ? t('mobile.settings.testing') : t('mobile.settings.testConnection')}
              </Text>
            </Pressable>
            <Pressable
              onPress={s.testing ? undefined : () => void s.saveDraft()}
              disabled={s.testing}
              className="min-h-[44px] flex-1 items-center justify-center rounded-xl bg-default active:opacity-80 disabled:opacity-50"
            >
              <Text className="text-[14px] font-semibold text-default-foreground">
                {s.editingId ? t('mobile.settings.saveEdit') : t('mobile.settings.saveConnect')}
              </Text>
            </Pressable>
          </View>
        </Group>
      ) : null}

      <Scanner visible={s.scannerOpen} onClose={() => s.setScannerOpen(false)} onScanned={(r) => void s.scanned(r)} />
      <FingerprintSheet prompt={s.finger} onAnswer={s.answerFinger} />
    </>
  );
}

function ServerRow({
  server,
  active,
  editing,
  testing,
  onOpen,
  onTest,
  onDelete
}: {
  server: SavedServer;
  active: boolean;
  editing: boolean;
  testing: boolean;
  onOpen: () => void;
  onTest: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const { scheme } = useThemeMode();
  const isDark = scheme === 'dark';
  const meta = [
    t(`mobile.settings.transport_${server.transport ?? 'lan'}`),
    lastConnected(t, server),
    server.fingerprint ? t('mobile.settings.fingerprintPinned') : null
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={onOpen}
      className="min-h-[56px] flex-row items-center gap-3 py-3 pl-4 pr-2 active:bg-surface-secondary/40"
    >
      <View
        style={{
          backgroundColor: active
            ? isDark
              ? 'rgba(34, 197, 94, 0.18)'
              : '#dcfce7'
            : isDark
              ? 'rgba(148, 163, 184, 0.12)'
              : '#f1f5f9'
        }}
        className="h-8 w-8 items-center justify-center rounded-lg"
      >
        <Glyph
          name={active ? 'check' : 'server'}
          size={16}
          color={active ? (isDark ? '#4ade80' : '#16a34a') : vars['--muted']}
        />
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
            {server.label.trim() || t('mobile.settings.unnamedServer')}
          </Text>
          {active ? (
            <View className="rounded bg-success/15 px-1.5 py-0.5">
              <Text className="text-[10px] font-bold text-success">{t('mobile.settings.active')}</Text>
            </View>
          ) : null}
          {editing ? <Text className="text-[12px] text-muted">{t('mobile.settings.editing')}</Text> : null}
        </View>
        <Text numberOfLines={1} className="mt-0.5 font-mono text-[11px] text-muted">
          {server.serverUrl}
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-[11px] text-muted">
          {meta}
        </Text>
        {server.fingerprint ? null : (
          <Text className="mt-0.5 text-[11px] text-warning">{t('mobile.settings.fingerprintMissing')}</Text>
        )}
      </View>
      <Pressable
        onPress={onTest}
        disabled={testing}
        className="rounded-lg border border-border/80 dark:border-white/10 bg-surface px-2.5 py-1.5 active:opacity-60 disabled:opacity-40"
      >
        <Text className="text-[12px] font-semibold text-link">{t('mobile.settings.test')}</Text>
      </Pressable>
      <Pressable
        onPress={onDelete}
        accessibilityLabel={t('shell.common.delete')}
        className="h-10 w-10 items-center justify-center active:opacity-60"
      >
        <Glyph name="cross" size={14} color={vars['--muted']} />
      </Pressable>
    </Pressable>
  );
}
