import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clipboard,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeInDown,
  FadeOutUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from 'react-native-reanimated';

import { bridgeStore, type SessionSummary } from '@/bridge/store';
import { useHomeIds } from '@/bridge/use-home';
import { usePersona } from '@/bridge/use-persona';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { sessionComposerGate } from '@/components/chat/gate';
import { ConnectionBanner } from '@/components/connection';
import { ScreenHeader } from '@/components/glass-header';
import { Glyph } from '@/components/glyphs';
import { Avatar } from '@/components/shell/avatar';
import { DisconnectedState } from '@/components/shell/disconnected-state';
import { SectionLabel, Sheet } from '@/components/shell/sheet';
import { useTabBarSpace } from '@/components/shell/tab-bar';
import { lightImpact, mediumImpact } from '@/lib/haptics';
import { useThemeMode, useThemeVars } from '@/theme/theme-context';

function formatTime(lastModified: string): string {
  const d = new Date(lastModified);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function RunningRadar() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.7);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.85, { duration: 950, easing: Easing.out(Easing.ease) }),
      -1,
      false
    );
    opacity.value = withRepeat(
      withTiming(0, { duration: 950, easing: Easing.out(Easing.ease) }),
      -1,
      false
    );
    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
    };
  }, [scale, opacity]);

  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value
  }));

  return (
    <View className="h-9 w-9 items-center justify-center rounded-xl bg-focus/15">
      <Animated.View style={haloStyle} className="absolute h-6 w-6 rounded-full bg-focus" />
      <View className="h-2.5 w-2.5 rounded-full bg-focus" />
    </View>
  );
}

export default function HistoryScreen() {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const { scheme } = useThemeMode();
  const isDark = scheme === 'dark';
  const router = useRouter();
  const snapshot = useBridgeSnapshot();
  const homeIds = useHomeIds();
  const persona = usePersona();
  const bottomSpace = useTabBarSpace();

  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionSession, setActionSession] = useState<SessionSummary | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => {
      setToast(null);
    }, 1800);
  }, []);

  const isSessionRunning = useCallback(
    (id: string) => {
      const rec = snapshot.records[id];
      if (!rec) return snapshot.queuedSessionId === id;
      const gate = sessionComposerGate(rec, snapshot.connection === 'open');
      return gate?.runState === 'running' || snapshot.queuedSessionId === id;
    },
    [snapshot.records, snapshot.connection, snapshot.queuedSessionId]
  );

  const allSessions = useMemo(
    () => Object.values(snapshot.sessionsByProject).flat(),
    [snapshot.sessionsByProject]
  );
  const hasAnySessions = allSessions.length > 0;

  const { home, temp } = useMemo(() => {
    const h = allSessions.find((s) => homeIds.has(s.id));
    const rawTemp = allSessions
      .filter((s) => s.id !== h?.id)
      .sort((a, b) => Date.parse(b.lastModified) - Date.parse(a.lastModified));

    const q = search.trim().toLowerCase();
    if (!q) {
      return { home: h, temp: rawTemp };
    }

    const matches = (s: SessionSummary) =>
      s.title?.toLowerCase().includes(q) ||
      s.summary?.toLowerCase().includes(q) ||
      s.engineKind?.toLowerCase().includes(q) ||
      s.runMode?.toLowerCase().includes(q);

    return {
      home: h && matches(h) ? h : undefined,
      temp: rawTemp.filter(matches)
    };
  }, [snapshot.sessionsByProject, homeIds, search]);

  const openSession = useCallback(
    (sid: string) => {
      lightImpact();
      router.push(`/session/${sid}`);
    },
    [router]
  );

  const create = useCallback(async () => {
    lightImpact();
    const sid = await bridgeStore.createSession();
    if (sid) router.push(`/session/${sid}`);
    else console.warn('[history] creating a session failed');
  }, [router]);

  const onRefresh = useCallback(() => {
    lightImpact();
    setRefreshing(true);
    bridgeStore.refreshSessions();
    setTimeout(() => {
      setRefreshing(false);
    }, 600);
  }, []);

  const handleLongPress = useCallback((session: SessionSummary) => {
    mediumImpact();
    setActionSession(session);
  }, []);

  const isHomeRunning = home ? isSessionRunning(home.id) : false;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        banner={<ConnectionBanner />}
        className="min-h-11 flex-row items-center justify-between pl-4 pr-1"
      >
        <Text className="text-[17px] font-semibold text-foreground">{t('mobile.history.title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.history.newSessionA11y')}
          onPress={() => void create()}
          hitSlop={8}
          className="h-11 w-11 items-center justify-center active:opacity-60"
        >
          <Glyph name="plus" size={22} color={vars['--foreground']} />
        </Pressable>
      </ScreenHeader>
      <View style={{ height: StyleSheet.hairlineWidth }} className="bg-separator" />

      {/* Floating Pill Toast */}
      {toast ? (
        <Animated.View
          entering={FadeInDown.springify().damping(16)}
          exiting={FadeOutUp.duration(150)}
          style={{ position: 'absolute', top: 56, alignSelf: 'center', zIndex: 100 }}
          pointerEvents="none"
          className="flex-row items-center gap-2 rounded-full border border-black/[0.04] bg-surface px-4 py-2 shadow-lg dark:border-white/10 dark:border-t-white/25"
        >
          <Glyph name="check" size={14} color="#17c964" />
          <Text className="text-[13px] font-semibold text-foreground">{toast}</Text>
        </Animated.View>
      ) : null}

      {snapshot.connection === 'idle' ||
      snapshot.connection === 'rejected' ||
      snapshot.connUi === 'unconfigured' ? (
        <View className="flex-1 justify-center py-20">
          <DisconnectedState bottomSpace={bottomSpace} />
        </View>
      ) : !snapshot.sessionsLoaded && !hasAnySessions ? (
        <View className="flex-1 items-center justify-center gap-4 py-24" style={{ paddingBottom: bottomSpace }}>
          <Avatar size={56} />
          <Text className="text-center text-[13px] text-muted">
            {snapshot.connection === 'open'
              ? t('mobile.history.loadingList')
              : t('mobile.history.connectingDesktop')}
          </Text>
        </View>
      ) : !hasAnySessions && !search ? (
        <View className="flex-1 items-center justify-center gap-3 px-6 py-20" style={{ paddingBottom: bottomSpace }}>
          <View className="h-14 w-14 items-center justify-center rounded-2xl border border-black/[0.04] bg-surface-secondary dark:border-white/10">
            <Glyph name="chat" size={24} color={vars['--muted']} />
          </View>
          <Text className="text-[16px] font-semibold text-foreground">
            {t('mobile.history.emptyTitle')}
          </Text>
          <Text className="text-center text-[13px] leading-5 text-muted">
            {t('mobile.history.emptyBody')}
          </Text>
        </View>
      ) : (
        <View className="flex-1">
          <FlashList
            data={temp}
            keyExtractor={(s) => s.id}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={vars['--focus']}
                colors={[vars['--focus']]}
              />
            }
            contentContainerStyle={{ paddingBottom: bottomSpace + 24 }}
            ListHeaderComponent={
              <>
                {/* Instant Capsule Search Bar */}
                <View className="mb-3 px-4 pt-2">
                  <View
                    style={{
                      borderColor: searchFocused ? vars['--focus'] : undefined,
                      shadowColor: vars['--focus'],
                      shadowOffset: { width: 0, height: 0 },
                      shadowOpacity: searchFocused ? 0.22 : 0,
                      shadowRadius: 5
                    }}
                    className={`h-9 flex-row items-center rounded-full border bg-surface-secondary px-3 ${
                      searchFocused
                        ? 'border-focus'
                        : 'border-black/[0.04] dark:border-white/10 dark:border-t-white/15'
                    }`}
                  >
                    <Glyph name="search" size={15} color={searchFocused ? vars['--focus'] : vars['--muted']} />
                    <TextInput
                      value={search}
                      onChangeText={setSearch}
                      onFocus={() => setSearchFocused(true)}
                      onBlur={() => setSearchFocused(false)}
                      placeholder={t('mobile.history.searchPlaceholder')}
                      placeholderTextColor={vars['--muted']}
                      className="ml-2 flex-1 p-0 text-[13px] text-foreground"
                      clearButtonMode="while-editing"
                    />
                    {search ? (
                      <Pressable onPress={() => setSearch('')} hitSlop={8} className="p-1 active:opacity-60">
                        <Glyph name="cross" size={13} color={vars['--muted']} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>

                {/* Main Session Hero Card */}
                {home ? (
                  <View className="mb-4 px-4 pt-1">
                    <View className="mb-2 flex-row items-center justify-between px-1">
                      <Text className="text-[13px] font-semibold text-muted">
                        {t('mobile.history.mainGroup')}
                      </Text>
                      {isHomeRunning ? (
                        <View className="flex-row items-center gap-1.5 rounded-full bg-focus/10 px-2 py-0.5">
                          <View className="h-1.5 w-1.5 rounded-full bg-focus" />
                          <Text className="text-[11px] font-semibold text-focus">
                            {t('mobile.history.running')}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => openSession(home.id)}
                      onLongPress={() => handleLongPress(home)}
                      style={{
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: isDark ? 2 : 1 },
                        shadowOpacity: isDark ? 0.35 : 0.04,
                        shadowRadius: isDark ? 6 : 8,
                        elevation: isDark ? 2 : 1
                      }}
                      className="flex-row items-center gap-3.5 rounded-2xl border border-black/[0.04] bg-surface p-3.5 dark:border-white/10 dark:border-t-white/20 active:bg-surface-secondary/50"
                    >
                      <Avatar size={42} mood={isHomeRunning ? 'working' : 'idle'} />
                      <View className="min-w-0 flex-1">
                        <View className="flex-row items-baseline justify-between gap-2">
                          <Text numberOfLines={1} className="flex-1 text-[16px] font-semibold text-foreground">
                            {persona.name || t('mobile.home.title')}
                          </Text>
                          <Text className="text-[11px] font-medium text-muted">
                            {formatTime(home.lastModified)}
                          </Text>
                        </View>
                        <Text numberOfLines={1} className="mt-1 text-[13px] leading-snug text-muted">
                          {home.summary || t('mobile.home.greeting', { name: persona.name })}
                        </Text>
                      </View>
                      <Glyph name="chevron-right" size={14} color={vars['--muted']} />
                    </Pressable>
                  </View>
                ) : null}

                {/* Temporary Sessions Section Title */}
                {temp.length > 0 || search ? (
                  <View className="mb-2 flex-row items-center justify-between px-5 pt-1">
                    <Text className="text-[13px] font-semibold text-muted">
                      {t('mobile.history.tempGroup')}
                    </Text>
                    <View className="rounded-full bg-surface-secondary px-2 py-0.5">
                      <Text className="font-mono text-[11px] font-medium text-muted">{temp.length}</Text>
                    </View>
                  </View>
                ) : null}
              </>
            }
            renderItem={({ item }) => {
              const running = isSessionRunning(item.id);
              return (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => openSession(item.id)}
                  onLongPress={() => handleLongPress(item)}
                  style={{
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: isDark ? 2 : 1 },
                    shadowOpacity: isDark ? 0.28 : 0.03,
                    shadowRadius: isDark ? 4 : 6,
                    elevation: 1
                  }}
                  className="mx-4 mb-2.5 flex-row items-center gap-3 rounded-2xl border border-black/[0.04] bg-surface p-3 dark:border-white/10 dark:border-t-white/18 active:bg-surface-secondary/50"
                >
                  {running ? (
                    <RunningRadar />
                  ) : (
                    <View className="h-9 w-9 items-center justify-center rounded-xl bg-focus/10 dark:bg-focus/15">
                      <Glyph name="chat" size={16} color={vars['--focus']} />
                    </View>
                  )}
                  <View className="min-w-0 flex-1">
                    <View className="flex-row items-baseline justify-between gap-2">
                      <Text numberOfLines={1} className="flex-1 text-[15px] font-semibold text-foreground">
                        {item.title || t('shell.common.unnamed')}
                      </Text>
                      <Text className="text-[11px] font-medium text-muted">
                        {formatTime(item.lastModified)}
                      </Text>
                    </View>
                    <View className="mt-1 flex-row items-center gap-1.5">
                      {item.engineKind ? (
                        <View className="rounded border border-black/[0.03] bg-surface-secondary px-1.5 py-0.5 dark:border-white/8">
                          <Text className="font-mono text-[10px] font-medium text-muted">
                            {item.engineKind}
                          </Text>
                        </View>
                      ) : null}
                      <Text numberOfLines={1} className="flex-1 text-[12px] text-muted">
                        {running
                          ? t('mobile.history.running')
                          : item.summary || t('mobile.history.noMessages')}
                      </Text>
                    </View>
                  </View>
                  <Glyph name="chevron-right" size={13} color={vars['--muted']} />
                </Pressable>
              );
            }}
            ListEmptyComponent={
              search ? (
                <View className="items-center justify-center gap-3 px-6 py-16">
                  <View className="h-14 w-14 items-center justify-center rounded-2xl border border-black/[0.04] bg-surface-secondary dark:border-white/10">
                    <Glyph name="search" size={24} color={vars['--muted']} />
                  </View>
                  <Text className="text-[16px] font-semibold text-foreground">
                    {t('mobile.history.searchNoResult')}
                  </Text>
                  <Pressable
                    onPress={() => setSearch('')}
                    className="mt-1 rounded-xl bg-surface-secondary px-3.5 py-2 active:opacity-70"
                  >
                    <Text className="text-[13px] font-medium text-link">
                      {t('mobile.history.clearSearch')}
                    </Text>
                  </Pressable>
                </View>
              ) : null
            }
          />
        </View>
      )}

      {/* Session Actions & Details Bottom Sheet */}
      <Sheet
        visible={actionSession !== null}
        onClose={() => setActionSession(null)}
        title={actionSession?.title || t('mobile.history.sessionActions')}
      >
        <SectionLabel>{t('mobile.history.sessionActions')}</SectionLabel>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (actionSession) {
              Clipboard.setString(actionSession.title || '');
              mediumImpact();
              showToast(t('mobile.chat.copied'));
              setActionSession(null);
            }
          }}
          className="min-h-12 flex-row items-center gap-3 rounded-xl px-2 active:bg-surface-secondary"
        >
          <Glyph name="copy" size={17} color={vars['--foreground']} />
          <Text className="text-[15px] font-medium text-overlay-foreground">
            {t('mobile.history.copyTitle')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (actionSession) {
              Clipboard.setString(actionSession.id);
              mediumImpact();
              showToast(t('mobile.chat.copied'));
              setActionSession(null);
            }
          }}
          className="min-h-12 flex-row items-center gap-3 rounded-xl px-2 active:bg-surface-secondary"
        >
          <Glyph name="link" size={17} color={vars['--foreground']} />
          <Text className="text-[15px] font-medium text-overlay-foreground">
            {t('mobile.history.copyId')}
          </Text>
        </Pressable>

        <SectionLabel>{t('mobile.history.sessionDetails')}</SectionLabel>
        <View className="gap-2 rounded-2xl border border-black/[0.03] bg-surface-secondary p-3.5 dark:border-white/8">
          <View className="flex-row items-center justify-between">
            <Text className="text-[13px] text-muted">ID</Text>
            <Text className="font-mono text-[12px] text-overlay-foreground" selectable>
              {actionSession?.id}
            </Text>
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-[13px] text-muted">{t('mobile.history.lastActive')}</Text>
            <Text className="text-[12px] text-overlay-foreground">
              {actionSession ? formatTime(actionSession.lastModified) : ''}
            </Text>
          </View>
          {actionSession?.engineKind ? (
            <View className="flex-row items-center justify-between">
              <Text className="text-[13px] text-muted">Engine</Text>
              <Text className="font-mono text-[12px] text-overlay-foreground">
                {actionSession.engineKind}
              </Text>
            </View>
          ) : null}
          {actionSession?.runMode ? (
            <View className="flex-row items-center justify-between">
              <Text className="text-[13px] text-muted">Mode</Text>
              <Text className="font-mono text-[12px] text-overlay-foreground">
                {actionSession.runMode}
              </Text>
            </View>
          ) : null}
        </View>
      </Sheet>
    </View>
  );
}
