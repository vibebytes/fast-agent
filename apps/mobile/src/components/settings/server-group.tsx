import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import type { SavedServer } from '@/bridge/config';
import { Glyph } from '@/components/glyphs';
import { useThemeVars } from '@/theme/theme-context';
import { FieldRow, Group, Row } from './group';
import { FingerprintSheet, Scanner } from './pairing';
import { useServers } from './use-servers';

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
  const s = useServers();
  const active = s.servers.find((x) => x.id === s.activeServerId);

  return (
    <>
      <Group
        title={t('mobile.settings.bridge')}
        footer={s.connected ? t('mobile.settings.syncReady') : t('mobile.settings.notConnected')}
      >
        <Row label={t('mobile.settings.scanPair')} tone="link" onPress={() => void s.openScanner()} />
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
          tone="link"
          onPress={s.toggleForm}
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
          <Row
            label={s.testing ? t('mobile.settings.testing') : t('mobile.settings.testConnection')}
            tone="link"
            onPress={s.testing ? undefined : () => void s.testDraft()}
          />
          <Row
            label={s.editingId ? t('mobile.settings.saveEdit') : t('mobile.settings.saveConnect')}
            tone="link"
            onPress={s.testing ? undefined : () => void s.saveDraft()}
          />
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
  const meta = [
    t(`mobile.settings.transport_${server.transport ?? 'lan'}`),
    lastConnected(t, server),
    server.fingerprint ? t('mobile.settings.fingerprintPinned') : null
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable onPress={onOpen} className="min-h-11 flex-row items-center gap-2 py-2.5 pl-4 pr-1 active:opacity-60">
      <View className="w-4 items-center">
        {active ? <Glyph name="check" size={16} color={vars['--link']} /> : null}
      </View>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[15px] text-surface-secondary-foreground">
          {server.label.trim() || t('mobile.settings.unnamedServer')}
          {editing ? <Text className="text-[13px] text-muted">{`  ${t('mobile.settings.editing')}`}</Text> : null}
        </Text>
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
      <Pressable onPress={onTest} disabled={testing} className="min-h-11 justify-center px-2 active:opacity-60 disabled:opacity-30">
        <Text className="text-[13px] font-semibold text-link">{t('mobile.settings.test')}</Text>
      </Pressable>
      <Pressable
        onPress={onDelete}
        accessibilityLabel={t('shell.common.delete')}
        className="h-11 w-11 items-center justify-center active:opacity-60"
      >
        <Glyph name="cross" size={14} color={vars['--muted']} />
      </Pressable>
    </Pressable>
  );
}
