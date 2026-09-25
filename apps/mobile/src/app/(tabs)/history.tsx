import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { bridgeStore, type SessionSummary } from '@/bridge/store';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { ConnectionBanner } from '@/components/connection';
import { ScreenHeader } from '@/components/glass-header';
import { Glyph } from '@/components/glyphs';
import { useThemeVars } from '@/theme/theme-context';

type Bucket = 'today' | 'yesterday' | 'week' | 'older';

const BUCKET_ORDER: Bucket[] = ['today', 'yesterday', 'week', 'older'];

type Row =
  | { kind: 'header'; bucket: Bucket; count: number }
  | { kind: 'session'; session: SessionSummary };

function bucketOf(lastModified: string): Bucket {
  const ts = new Date(lastModified).getTime();
  const diff = Date.now() - (isNaN(ts) ? Date.now() : ts);
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'today';
  if (diff < 2 * day) return 'yesterday';
  if (diff < 7 * day) return 'week';
  return 'older';
}

function formatTime(lastModified: string): string {
  const d = new Date(lastModified);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function HistoryScreen() {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const router = useRouter();
  const snapshot = useBridgeSnapshot();
  const [browsingAll, setBrowsingAll] = useState(true);

  const projects = snapshot.projects ?? [];

  const allRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: SessionSummary[] = [];
    for (const group of Object.values(snapshot.sessionsByProject)) {
      for (const session of group) {
        if (seen.has(session.id)) continue;
        seen.add(session.id);
        rows.push(session);
      }
    }
    return rows;
  }, [snapshot.sessionsByProject]);

  const list = useMemo(() => {
    if (browsingAll) return allRows;
    const projectId = snapshot.projectId;
    return projectId ? (snapshot.sessionsByProject[projectId] ?? []) : [];
  }, [allRows, browsingAll, snapshot.projectId, snapshot.sessionsByProject]);

  const buckets = useMemo(() => {
    const map: Record<Bucket, SessionSummary[]> = {
      today: [],
      yesterday: [],
      week: [],
      older: []
    };
    for (const s of list) {
      map[bucketOf(s.lastModified)].push(s);
    }
    return map;
  }, [list]);

  const activeSessionId = snapshot.lastSessionId;

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const bucket of BUCKET_ORDER) {
      const items = buckets[bucket];
      if (items.length === 0) continue;
      out.push({ kind: 'header', bucket, count: items.length });
      for (const session of items) out.push({ kind: 'session', session });
    }
    return out;
  }, [buckets]);

  const renderRow = useCallback(
    ({ item }: { item: Row }) =>
      item.kind === 'header' ? (
        <View className="mb-2.5 mt-4 flex-row items-center gap-1.5 px-1">
          <View className="h-1.5 w-1.5 rounded-full bg-primary/70" />
          <Text className="text-[11px] font-bold uppercase tracking-wider text-muted">
            {t(`mobile.history.${item.bucket}`)} · {item.count}
          </Text>
        </View>
      ) : (
        <View className="mb-2.5">
          <SessionCard
            session={item.session}
            isActive={item.session.id === activeSessionId}
            onOpen={() => {
              router.push(`/session/${item.session.id}`);
            }}
          />
        </View>
      ),
    [t, activeSessionId, router]
  );

  const keyExtractor = useCallback(
    (item: Row) => (item.kind === 'header' ? `h-${item.bucket}` : `s-${item.session.id}`),
    []
  );

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        banner={<ConnectionBanner />}
        className="flex-row items-center justify-between border-b border-border/70 px-4 py-3.5"
      >
        <View>
          <Text className="text-xl font-bold tracking-tight text-foreground">{t('mobile.history.title')}</Text>
          <Text className="text-[11px] font-medium text-muted">{t('mobile.history.count', { count: list.length })}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.history.newSessionA11y')}
          onPress={async () => {
            const sid = await bridgeStore.createSession();
            if (sid) {
              router.push(`/session/${sid}`);
            }
          }}
          className="flex-row items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 shadow-sm active:scale-95 active:opacity-85"
        >
          <Glyph name="plus" size={14} color={vars['--primary-foreground']} />
          <Text className="text-xs font-semibold text-primary-foreground">{t('mobile.history.newSession')}</Text>
        </Pressable>
      </ScreenHeader>

      {/* Project Selector Horizontal Rail */}
      {projects.length > 0 ? (
        <View className="border-b border-border/40 bg-surface/30 py-2.5">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-4">
            <View className="flex-row items-center gap-2 pr-8">
              <Pressable
                onPress={() => setBrowsingAll(true)}
                className={`min-h-11 justify-center rounded-full px-3.5 ${
                  browsingAll ? 'bg-primary shadow-sm' : 'border border-border/80 bg-surface'
                } active:scale-95`}
              >
                <Text className={`text-xs font-semibold ${browsingAll ? 'text-primary-foreground' : 'text-muted'}`}>
                  {t('mobile.history.allCount', { count: allRows.length })}
                </Text>
              </Pressable>
              {projects.map((p) => {
                const count = snapshot.sessionsByProject[p.id]?.length ?? 0;
                const active = !browsingAll && snapshot.projectId === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      setBrowsingAll(false);
                      bridgeStore.setProject(p.id);
                    }}
                    className={`min-h-11 justify-center rounded-full px-3.5 ${
                      active ? 'bg-primary shadow-sm' : 'border border-border/80 bg-surface'
                    } active:scale-95`}
                  >
                    <Text
                      className={`text-xs font-semibold ${
                        active ? 'text-primary-foreground' : 'text-muted'
                      }`}
                    >
                      {p.name} ({count})
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>
      ) : null}

      <FlashList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderRow}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
            !snapshot.sessionsLoaded ? (
            <View className="items-center justify-center py-24">
              <View className="h-2.5 w-2.5 animate-ping rounded-full bg-primary" />
              <Text className="mt-4 text-xs text-muted">
                {snapshot.connection === 'open' ? t('mobile.history.loadingList') : t('mobile.history.connectingDesktop')}
              </Text>
            </View>
          ) : (
            <View className="items-center justify-center py-24">
              <View className="h-16 w-16 items-center justify-center rounded-3xl border border-border/60 bg-surface shadow-sm">
                <Glyph name="history" size={28} color={vars['--muted']} />
              </View>
              <Text className="mt-4 text-base font-semibold text-foreground">{t('mobile.history.emptyTitle')}</Text>
              <Text className="mt-1 text-xs text-muted">{t('mobile.history.emptyBody')}</Text>
            </View>
          )
        }
        ListFooterComponent={rows.length > 0 ? <View className="h-10" /> : null}
      />
    </View>
  );
}

function SessionCard({
  session,
  isActive,
  onOpen
}: {
  session: SessionSummary;
  isActive: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      className={`min-h-11 flex-row items-center justify-between gap-3 border-b border-border/50 px-1 py-3 ${
        isActive ? 'bg-primary/10' : 'active:bg-surface-secondary/60'
      }`}
    >
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[15px] font-semibold text-foreground">
          {session.title || t('shell.common.unnamed')}
        </Text>
        {[session.summary, session.runMode, session.engineKind].filter(Boolean).length > 0 ? (
          <Text numberOfLines={1} className="mt-0.5 text-xs text-muted">
            {[session.summary, session.runMode, session.engineKind].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>
      <Text className="text-[11px] font-mono text-muted">{formatTime(session.lastModified)}</Text>
    </Pressable>
  );
}
