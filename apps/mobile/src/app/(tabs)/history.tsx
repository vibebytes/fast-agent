import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { bridgeStore, type SessionSummary } from '@/bridge/store';
import { useHomeIds } from '@/bridge/use-home';
import { usePersona } from '@/bridge/use-persona';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { ConnectionBanner } from '@/components/connection';
import { ScreenHeader } from '@/components/glass-header';
import { Glyph } from '@/components/glyphs';
import { Avatar } from '@/components/shell/avatar';
import { Hairline } from '@/components/shell/sheet';
import { useTabBarSpace } from '@/components/shell/tab-bar';
import { useThemeVars } from '@/theme/theme-context';

type Row =
  | { kind: 'group'; id: 'main' | 'temp' }
  | { kind: 'home'; session: SessionSummary }
  | { kind: 'session'; session: SessionSummary; first: boolean };

function formatTime(lastModified: string): string {
  const d = new Date(lastModified);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function summaryOf(session: SessionSummary): string {
  return [session.summary, session.runMode, session.engineKind].filter(Boolean).join(' · ');
}

export default function HistoryScreen() {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const router = useRouter();
  const snapshot = useBridgeSnapshot();
  const homeIds = useHomeIds();
  const bottomSpace = useTabBarSpace();

  const rows = useMemo(() => {
    const all = Object.values(snapshot.sessionsByProject).flat();
    const home = all.find((s) => homeIds.has(s.id));
    const temp = all
      .filter((s) => s.id !== home?.id)
      .sort((a, b) => Date.parse(b.lastModified) - Date.parse(a.lastModified));
    const out: Row[] = [];
    if (home) out.push({ kind: 'group', id: 'main' }, { kind: 'home', session: home });
    if (temp.length > 0) {
      out.push({ kind: 'group', id: 'temp' });
      temp.forEach((session, i) => out.push({ kind: 'session', session, first: i === 0 }));
    }
    return out;
  }, [snapshot.sessionsByProject, homeIds]);

  const create = useCallback(async () => {
    const sid = await bridgeStore.createSession();
    if (sid) router.push(`/session/${sid}`);
    else console.warn('[history] creating a session failed');
  }, [router]);

  const sticky = useMemo(
    () => rows.flatMap((row, i) => (row.kind === 'group' ? [i] : [])),
    [rows]
  );

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'group') {
        return (
          <View className="min-h-11 flex-row items-center bg-background pl-4 pr-1 pt-3">
            <Text numberOfLines={1} className="flex-1 text-[13px] text-muted">
              {item.id === 'main' ? t('mobile.history.mainGroup') : t('mobile.history.tempGroup')}
            </Text>
          </View>
        );
      }
      const open = () => router.push(`/session/${item.session.id}`);
      if (item.kind === 'home') {
        return (
          <Pressable
            accessibilityRole="button"
            onPress={open}
            className="min-h-11 flex-row items-center gap-3 px-4 py-3 active:bg-surface-secondary"
          >
            <Avatar size={32} />
            <SessionText title={t('mobile.home.title')} summary={summaryOf(item.session)} time={item.session.lastModified} />
          </Pressable>
        );
      }
      return (
        <View>
          {item.first ? null : (
            <View className="pl-4">
              <Hairline />
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={open}
            className="min-h-11 flex-row items-center px-4 py-3 active:bg-surface-secondary"
          >
            <SessionText
              title={item.session.title || t('shell.common.unnamed')}
              summary={summaryOf(item.session)}
              time={item.session.lastModified}
            />
          </Pressable>
        </View>
      );
    },
    [t, router]
  );

  const keyExtractor = useCallback(
    (item: Row) => (item.kind === 'group' ? `g-${item.id}` : `${item.kind}-${item.session.id}`),
    []
  );

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader banner={<ConnectionBanner />} className="min-h-11 flex-row items-center justify-between pl-4 pr-1">
        <Text className="text-[17px] font-semibold text-foreground">{t('mobile.history.title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.history.newSessionA11y')}
          onPress={() => void create()}
          className="h-11 w-11 items-center justify-center active:opacity-60"
        >
          <Glyph name="plus" size={22} color={vars['--foreground']} />
        </Pressable>
      </ScreenHeader>
      <View style={{ height: StyleSheet.hairlineWidth }} className="bg-separator" />

      <FlashList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderRow}
        getItemType={(item) => item.kind}
        stickyHeaderIndices={sticky}
        contentContainerStyle={{ paddingBottom: bottomSpace + 16 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View className="items-center justify-center gap-4 py-24">
            <Avatar size={48} />
            {!snapshot.sessionsLoaded ? (
              <Text className="text-[13px] text-muted">
                {snapshot.connection === 'open' ? t('mobile.history.loadingList') : t('mobile.history.connectingDesktop')}
              </Text>
            ) : (
              <>
                <Text className="text-[15px] font-semibold text-foreground">{t('mobile.history.emptyTitle')}</Text>
                <Text className="text-[13px] text-muted">{t('mobile.history.emptyBody')}</Text>
              </>
            )}
          </View>
        }
      />
    </View>
  );
}

function SessionText({ title, summary, time }: { title: string; summary: string; time: string }) {
  return (
    <View className="min-w-0 flex-1">
      <View className="flex-row items-baseline gap-3">
        <Text numberOfLines={1} className="flex-1 text-[15px] text-foreground">
          {title}
        </Text>
        <Text className="text-[11px] text-muted">{formatTime(time)}</Text>
      </View>
      {summary ? (
        <Text numberOfLines={1} className="mt-0.5 text-[13px] text-muted">
          {summary}
        </Text>
      ) : null}
    </View>
  );
}
