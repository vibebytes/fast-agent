import { FlashList } from '@shopify/flash-list';
import { composerGate } from '@fast-ide/session-view';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { bridgeStore, type SessionSummary } from '@/bridge/store';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { ConnectionBanner } from '@/components/connection';
import { GlassHeader } from '@/components/glass-header';
import { Glyph } from '@/components/glyphs';
import { useThemeVars } from '@/theme/theme-context';

type Bucket = 'today' | 'yesterday' | 'week' | 'older';

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
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export default function HistoryScreen() {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const router = useRouter();
  const snapshot = useBridgeSnapshot();
  const [selectedProject, setSelectedProject] = useState<string>('all');

  const projects = snapshot.projects ?? [];
  const sessions = snapshot.sessions ?? [];

  const list = useMemo(() => {
    if (selectedProject === 'all') return sessions;
    return snapshot.sessionsByProject[selectedProject] ?? [];
  }, [sessions, selectedProject, snapshot.sessionsByProject]);

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
  const runningIds = useMemo(() => {
    const set = new Set<string>();
    for (const [id, rec] of Object.entries(snapshot.records)) {
      const state = composerGate(rec.transcript, true).runState;
      if (state === 'running' || state === 'stopping') set.add(id);
    }
    return set;
  }, [snapshot.records]);

  return (
    <View className="flex-1 bg-background">
      <ConnectionBanner />
      <GlassHeader className="flex-row items-center justify-between border-b border-border/70 px-4 py-3.5">
        <View>
          <Text className="text-xl font-bold tracking-tight text-foreground">{t('mobile.history.title')}</Text>
          <Text className="text-[11px] font-medium text-muted">{t('mobile.history.count', { count: sessions.length })}</Text>
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
      </GlassHeader>

      {/* Project Selector Horizontal Rail */}
      {projects.length > 0 ? (
        <View className="border-b border-border/40 bg-surface/30 py-2.5">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-4">
            <View className="flex-row items-center gap-2 pr-8">
              <Pressable
                onPress={() => {
                  setSelectedProject('all');
                }}
                className={`rounded-full px-3.5 py-1.5 transition-all ${
                  selectedProject === 'all'
                    ? 'bg-primary shadow-sm'
                    : 'border border-border/80 bg-surface'
                } active:scale-95`}
              >
                <Text
                  className={`text-xs font-semibold ${
                    selectedProject === 'all' ? 'text-primary-foreground' : 'text-muted'
                  }`}
                >
                  {t('mobile.history.allCount', { count: sessions.length })}
                </Text>
              </Pressable>
              {projects.map((p) => {
                const count = snapshot.sessionsByProject[p.id]?.length ?? 0;
                const active = selectedProject === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      setSelectedProject(p.id);
                    }}
                    className={`rounded-full px-3.5 py-1.5 transition-all ${
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

      <ScrollView className="flex-1 px-4 pt-3" showsVerticalScrollIndicator={false}>
        {(['today', 'yesterday', 'week', 'older'] as Bucket[]).map((bucket) => {
          const items = buckets[bucket];
          if (items.length === 0) return null;
          return (
            <View key={bucket} className="mb-5">
              <View className="mb-2.5 flex-row items-center gap-1.5 px-1">
                <View className="h-1.5 w-1.5 rounded-full bg-primary/70" />
                <Text className="text-[11px] font-bold uppercase tracking-wider text-muted">
                  {t(`mobile.history.${bucket}`)} · {items.length}
                </Text>
              </View>
              <View className="gap-2.5">
                {items.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    isActive={session.id === activeSessionId}
                    running={runningIds.has(session.id)}
                    onOpen={() => {
                      router.push(`/session/${session.id}`);
                    }}
                  />
                ))}
              </View>
            </View>
          );
        })}

        {!snapshot.sessionsLoaded ? (
          <View className="items-center justify-center py-24">
            <View className="h-2.5 w-2.5 animate-ping rounded-full bg-primary" />
            <Text className="mt-4 text-xs text-muted">
              {snapshot.connection === 'open' ? t('mobile.history.loadingList') : t('mobile.history.connectingDesktop')}
            </Text>
          </View>
        ) : list.length === 0 ? (
          <View className="items-center justify-center py-24">
            <View className="h-16 w-16 items-center justify-center rounded-3xl border border-border/60 bg-surface shadow-sm">
              <Glyph name="history" size={28} color={vars['--muted']} />
            </View>
            <Text className="mt-4 text-base font-semibold text-foreground">{t('mobile.history.emptyTitle')}</Text>
            <Text className="mt-1 text-xs text-muted">{t('mobile.history.emptyBody')}</Text>
          </View>
        ) : (
          <View className="h-10" />
        )}
      </ScrollView>
    </View>
  );
}

function SessionCard({
  session,
  isActive,
  running,
  onOpen
}: {
  session: SessionSummary;
  isActive: boolean;
  running: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      className={`overflow-hidden rounded-2xl border p-4 shadow-sm transition-all ${
        isActive
          ? 'border-primary/80 bg-primary/10 shadow-primary/10'
          : 'border-border/70 bg-surface active:bg-surface-secondary/60'
      } active:scale-[0.985]`}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            {running ? (
              <View className="flex-row items-center gap-1 rounded-full bg-success/15 px-2 py-0.5">
                <View className="h-1.5 w-1.5 animate-ping rounded-full bg-success" />
                <Text className="text-[10px] font-bold text-success">{t('mobile.history.running')}</Text>
              </View>
            ) : null}
            <Text numberOfLines={1} className="flex-1 text-[15px] font-semibold text-foreground tracking-tight">
              {session.title || t('shell.common.unnamed')}
            </Text>
          </View>
          {session.summary ? (
            <Text numberOfLines={2} className="mt-1.5 text-xs leading-relaxed text-muted">
              {session.summary}
            </Text>
          ) : null}
        </View>
      </View>

      <View className="mt-3 flex-row items-center justify-between border-t border-border/40 pt-2.5">
        <View className="flex-row items-center gap-2">
          {session.runMode ? (
            <View className="rounded-md border border-border/60 bg-surface-secondary/80 px-2 py-0.5">
              <Text className="text-[10px] font-medium text-foreground">{session.runMode}</Text>
            </View>
          ) : null}
          <Text className="text-[11px] font-medium text-muted">
            {session.messageCount ? t('mobile.history.messageCount', { count: session.messageCount }) : t('mobile.history.noMessages')}
          </Text>
        </View>
        <Text className="text-[11px] font-mono text-muted">{formatTime(session.lastModified)}</Text>
      </View>
    </Pressable>
  );
}
