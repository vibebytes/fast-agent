import { LOCALE_NATIVE_NAME, SUPPORTED, type LocalePref } from '@fast-ide/i18n/browser';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal, Pressable, ScrollView, TextInput, View, Text } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { formatCopy } from '@/bridge/copy';
import { parsePairingPayload } from '@/bridge/pairing';
import { bridgeStore } from '@/bridge/store';
import { loadBridgeConfig, type SavedServer } from '@/bridge/config';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { ConnectionBanner } from '@/components/connection';
import { GlassHeader } from '@/components/glass-header';
import { Glyph } from '@/components/glyphs';
import { useLocalePrefs } from '@/i18n/locale-context';
import { t as alertT } from '@/i18n/t';
import { PALETTES } from '@/theme/palettes';
import { useThemeMode, useThemeVars } from '@/theme/theme-context';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const { mode, setMode, paletteId, setPaletteId } = useThemeMode();
  const { localePref, setLocalePref } = useLocalePrefs();
  const snapshot = useBridgeSnapshot();
  const [permission, requestPermission] = useCameraPermissions();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [showAddServer, setShowAddServer] = useState(false);

  const [servers, setServers] = useState<SavedServer[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState('');
  const [newToken, setNewToken] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newFingerprint, setNewFingerprint] = useState('');
  const [testing, setTesting] = useState(false);
  const shownPendingFp = useRef<string | null>(null);

  const clearDraft = () => {
    setEditingId(null);
    setNewUrl('');
    setNewToken('');
    setNewLabel('');
    setNewFingerprint('');
  };

  const refreshServers = async () => {
    const config = await loadBridgeConfig();
    setServers(config.servers);
    setActiveServerId(config.activeServerId);
  };

  useEffect(() => {
    refreshServers();
  }, [snapshot.connection]);

  useEffect(() => {
    const pending = snapshot.pendingFingerprint;
    if (!pending) {
      shownPendingFp.current = null;
      return;
    }
    const key = `${pending.serverId}:${pending.fingerprint}`;
    if (shownPendingFp.current === key) return;
    shownPendingFp.current = key;
    Alert.alert(
      alertT('mobile.settings.fingerprintTitle'),
      alertT('mobile.pairing.confirmFingerprint', { fingerprint: pending.fingerprint }),
      [
        {
          text: alertT('mobile.settings.rejectFingerprint'),
          style: 'cancel',
          onPress: () => {
            void bridgeStore.confirmFingerprint(false);
          }
        },
        {
          text: alertT('mobile.settings.saveFingerprint'),
          onPress: () => {
            void bridgeStore.confirmFingerprint(true).then(refreshServers);
          }
        }
      ]
    );
  }, [snapshot.pendingFingerprint]);

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    setScannerOpen(false);
    const parsedPayload = parsePairingPayload(data);
    if (!parsedPayload) {
      Alert.alert(alertT('mobile.settings.pairFailTitle'), alertT('mobile.settings.pairFailBody'));
      return;
    }
    const id = await bridgeStore.saveServer({
      id: `srv-${Date.now()}`,
      serverUrl: parsedPayload.serverUrl,
      token: parsedPayload.token,
      label: '',
      fingerprint: parsedPayload.fingerprint ?? undefined
    });
    await refreshServers();
    if (!id) {
      Alert.alert(alertT('mobile.settings.pairFailTitle'), alertT('mobile.settings.pairFailBody'));
      return;
    }
    const probe = await bridgeStore.testConnection({
      serverUrl: parsedPayload.serverUrl,
      token: parsedPayload.token,
      fingerprint: parsedPayload.fingerprint ?? undefined
    });
    if (probe.ok) {
      Alert.alert(
        alertT('mobile.settings.pairSuccessTitle'),
        alertT('mobile.settings.pairSuccessBody', {url: parsedPayload.serverUrl})
      );
      return;
    }
    Alert.alert(
      alertT('mobile.settings.pairUnreachableTitle'),
      alertT('mobile.settings.pairUnreachableBody', {
        url: parsedPayload.serverUrl,
        reason: formatCopy(alertT, probe.detail)
      })
    );
  };

  const openScanner = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert(alertT('mobile.settings.cameraTitle'), alertT('mobile.settings.cameraBody'));
        return;
      }
    }
    setScannerOpen(true);
  };

  const draft = () => ({
    serverUrl: newUrl.trim(),
    token: newToken.trim(),
    fingerprint: newFingerprint.trim() || undefined
  });

  const persistServer = async (fingerprint?: string) => {
    await bridgeStore.saveServer({
      id: editingId ?? `srv-${Date.now()}`,
      serverUrl: newUrl.trim(),
      token: newToken.trim(),
      label: newLabel.trim(),
      fingerprint: fingerprint ?? (newFingerprint.trim() || undefined)
    });
    clearDraft();
    setShowAddServer(false);
    await refreshServers();
  };

  const askFingerprint = (fingerprint: string, onSave: () => void) => {
    Alert.alert(
      alertT('mobile.settings.fingerprintTitle'),
      alertT('mobile.pairing.confirmFingerprint', { fingerprint }),
      [
        { text: alertT('mobile.settings.rejectFingerprint'), style: 'cancel' },
        { text: alertT('mobile.settings.saveFingerprint'), onPress: onSave }
      ]
    );
  };

  const handleTest = async () => {
    if (!newUrl.trim() || !newToken.trim()) {
      Alert.alert(alertT('mobile.settings.fillTitle'), alertT('mobile.settings.fillBody'));
      return;
    }
    setTesting(true);
    try {
      const result = await bridgeStore.testConnection(draft());
      if (result.detail.code === 'confirmFingerprint' && result.fingerprint) {
        askFingerprint(result.fingerprint, () => {
          setNewFingerprint(result.fingerprint ?? '');
          Alert.alert(alertT('mobile.settings.fingerprintSaved'), result.fingerprint);
        });
        return;
      }
      Alert.alert(
        alertT(result.ok ? 'mobile.settings.testOkTitle' : 'mobile.settings.testFailTitle'),
        formatCopy(alertT, result.detail)
      );
    } finally {
      setTesting(false);
    }
  };

  const handleTestServer = async (server: SavedServer) => {
    setTesting(true);
    try {
      const result = await bridgeStore.testConnection(server);
      if (result.detail.code === 'confirmFingerprint' && result.fingerprint) {
        askFingerprint(result.fingerprint, () => {
          void bridgeStore
            .saveServer({...server, fingerprint: result.fingerprint})
            .then(refreshServers);
        });
        return;
      }
      Alert.alert(
        alertT(result.ok ? 'mobile.settings.testOkTitle' : 'mobile.settings.testFailTitle'),
        formatCopy(alertT, result.detail)
      );
    } finally {
      setTesting(false);
    }
  };

  const handleManualAdd = async () => {
    if (!newUrl.trim() || !newToken.trim()) {
      Alert.alert(alertT('mobile.settings.fillTitle'), alertT('mobile.settings.fillBody'));
      return;
    }
    setTesting(true);
    try {
      const result = await bridgeStore.testConnection(draft());
      if (result.detail.code === 'confirmFingerprint' && result.fingerprint) {
        askFingerprint(result.fingerprint, () => {
          void persistServer(result.fingerprint);
        });
        return;
      }
      if (!result.ok) {
        Alert.alert(alertT('mobile.settings.testFailTitle'), formatCopy(alertT, result.detail));
        return;
      }
      await persistServer();
    } finally {
      setTesting(false);
    }
  };

  const handleDeleteServer = async (id: string) => {
    if (editingId === id) {
      clearDraft();
      setShowAddServer(false);
    }
    await bridgeStore.deleteServer(id);
    await refreshServers();
  };

  const handleOpenServer = async (server: SavedServer) => {
    setEditingId(server.id);
    setNewLabel(server.label);
    setNewUrl(server.serverUrl);
    setNewToken(server.token);
    setNewFingerprint(server.fingerprint ?? '');
    setShowAddServer(true);
    await bridgeStore.setActiveServer(server.id);
    await refreshServers();
  };

  const toggleManualForm = () => {
    if (showAddServer && !editingId) {
      setShowAddServer(false);
      return;
    }
    clearDraft();
    setShowAddServer(true);
  };

  const isConnected = snapshot.connection === 'open';
  const languageOptions: LocalePref[] = ['system', ...SUPPORTED];

  return (
    <View className="flex-1 bg-background">
      <ConnectionBanner />
      <GlassHeader className="flex-row items-center justify-between border-b border-border/70 px-4 py-3.5">
        <View>
          <Text className="text-xl font-bold tracking-tight text-foreground">{t('mobile.settings.title')}</Text>
          <Text className="text-[11px] font-medium text-muted">{t('mobile.settings.subtitle')}</Text>
        </View>
      </GlassHeader>

      <ScrollView className="flex-1 px-4 pt-4" showsVerticalScrollIndicator={false}>
        <View className="mb-6">
          <Text className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-muted">
            {t('mobile.settings.bridge')}
          </Text>
          <View className="overflow-hidden rounded-3xl border border-border/80 bg-surface shadow-sm">
            <View className="p-4">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-3">
                  <View className="relative h-10 w-10 items-center justify-center rounded-2xl bg-surface-secondary">
                    <Glyph name="server" size={18} color={vars['--primary']} />
                    <View
                      className={`absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${
                        isConnected ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                    />
                  </View>
                  <View>
                    <Text className="text-sm font-bold text-foreground">
                      {servers.find((s) => s.id === activeServerId)?.label.trim() || t('mobile.settings.noActiveServer')}
                    </Text>
                    <Text className="text-xs text-muted">
                      {isConnected ? t('mobile.settings.syncReady') : t('mobile.settings.notConnected')}
                    </Text>
                  </View>
                </View>

                <Pressable
                  onPress={openScanner}
                  className="flex-row items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 active:scale-95 shadow-sm"
                >
                  <Glyph name="sparkles" size={13} color={vars['--primary-foreground']} />
                  <Text className="text-xs font-semibold text-primary-foreground">{t('mobile.settings.scanPair')}</Text>
                </Pressable>
              </View>

              {servers.length > 0 ? (
                <View className="mt-4 gap-2 border-t border-border/50 pt-3">
                  {servers.map((server) => {
                    const isSelected = server.id === activeServerId;
                    const isEditing = server.id === editingId;
                    return (
                      <Pressable
                        key={server.id}
                        onPress={() => {
                          void handleOpenServer(server);
                        }}
                        className={`flex-row items-center justify-between rounded-2xl p-3.5 transition-all ${
                          isEditing || isSelected
                            ? 'border border-primary/60 bg-primary/10 shadow-xs'
                            : 'border border-border/50 bg-surface-secondary/40'
                        } active:scale-[0.985]`}
                      >
                        <View className="flex-1 pr-2">
                          <Text className="text-xs font-bold text-foreground">
                            {server.label.trim() || t('mobile.settings.unnamedServer')}
                          </Text>
                          <Text numberOfLines={1} className="mt-0.5 font-mono text-[11px] text-muted">
                            {server.serverUrl}
                          </Text>
                          {server.fingerprint ? (
                            <Text numberOfLines={1} className="mt-0.5 font-mono text-[10px] text-muted">
                              {t('mobile.settings.fingerprintPinned')} · {server.fingerprint}
                            </Text>
                          ) : (
                            <Text className="mt-0.5 text-[10px] text-warning">{t('mobile.settings.fingerprintMissing')}</Text>
                          )}
                        </View>
                        <View className="flex-row items-center gap-2">
                          <Pressable
                            onPress={() => {
                              void handleTestServer(server);
                            }}
                            disabled={testing}
                            className="rounded-full border border-border px-2.5 py-1 active:bg-surface-secondary"
                          >
                            <Text className="text-[10px] font-semibold text-foreground">{t('mobile.settings.testConnection')}</Text>
                          </Pressable>
                          {isEditing ? (
                            <View className="rounded-full bg-primary px-2.5 py-0.5">
                              <Text className="text-[10px] font-bold text-primary-foreground">{t('mobile.settings.editing')}</Text>
                            </View>
                          ) : isSelected ? (
                            <View className="rounded-full bg-primary px-2.5 py-0.5">
                              <Text className="text-[10px] font-bold text-primary-foreground">{t('mobile.settings.active')}</Text>
                            </View>
                          ) : null}
                          <Pressable
                            onPress={() => handleDeleteServer(server.id)}
                            className="rounded-full p-1.5 active:bg-destructive/15"
                          >
                            <Glyph name="cross" size={12} color={vars['--muted']} />
                          </Pressable>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <Pressable
                onPress={toggleManualForm}
                className="mt-3.5 items-center justify-center py-1 active:opacity-75"
              >
                <Text className="text-xs font-semibold text-primary">
                  {showAddServer
                    ? editingId
                      ? t('mobile.settings.cancelEdit')
                      : t('mobile.settings.collapseManual')
                    : t('mobile.settings.addManual')}
                </Text>
              </Pressable>

              {showAddServer ? (
                <View className="mt-3 gap-2.5 rounded-2xl border border-border bg-surface-secondary/50 p-3.5">
                  {editingId ? (
                    <Text className="px-0.5 text-[11px] font-semibold text-primary">
                      {t('mobile.settings.editingServer')}
                    </Text>
                  ) : null}
                  <TextInput
                    value={newLabel}
                    onChangeText={setNewLabel}
                    placeholder={t('mobile.settings.labelPlaceholder')}
                    placeholderTextColor={vars['--muted']}
                    className="rounded-xl border border-border bg-surface px-3 py-2.5 text-xs text-foreground"
                  />
                  <TextInput
                    value={newUrl}
                    onChangeText={setNewUrl}
                    placeholder={t('mobile.settings.urlPlaceholder')}
                    placeholderTextColor={vars['--muted']}
                    autoCapitalize="none"
                    className="rounded-xl border border-border bg-surface px-3 py-2.5 text-xs font-mono text-foreground"
                  />
                  <TextInput
                    value={newToken}
                    onChangeText={setNewToken}
                    placeholder={t('mobile.settings.tokenPlaceholder')}
                    placeholderTextColor={vars['--muted']}
                    autoCapitalize="none"
                    className="rounded-xl border border-border bg-surface px-3 py-2.5 text-xs font-mono text-foreground"
                  />
                  <TextInput
                    value={newFingerprint}
                    onChangeText={setNewFingerprint}
                    placeholder={t('mobile.settings.fingerprintPlaceholder')}
                    placeholderTextColor={vars['--muted']}
                    autoCapitalize="none"
                    className="rounded-xl border border-border bg-surface px-3 py-2.5 text-xs font-mono text-foreground"
                  />
                  <Pressable
                    onPress={() => {
                      void handleTest();
                    }}
                    disabled={testing}
                    className="mt-1 items-center justify-center rounded-xl border border-border bg-surface py-3 active:scale-95"
                  >
                    <Text className="text-sm font-semibold text-foreground">
                      {testing ? t('mobile.settings.testing') : t('mobile.settings.testConnection')}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      void handleManualAdd();
                    }}
                    disabled={testing}
                    className="items-center justify-center rounded-xl bg-primary py-3 active:scale-95 shadow-sm"
                  >
                    <Text className="text-sm font-semibold text-primary-foreground">
                      {editingId ? t('mobile.settings.saveEdit') : t('mobile.settings.saveConnect')}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View className="mb-6">
          <Text className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-muted">
            {t('settings.general.appearance')}
          </Text>
          <View className="overflow-hidden rounded-3xl border border-border/80 bg-surface p-2 shadow-sm">
            <View className="flex-row gap-1.5 bg-surface-secondary/60 p-1 rounded-2xl border border-border/40">
              {(
                [
                  { id: 'system' as const, label: t('settings.common.system') },
                  { id: 'light' as const, label: t('mobile.settings.themeLight') },
                  { id: 'dark' as const, label: t('mobile.settings.themeDark') }
                ]
              ).map((item) => {
                const active = mode === item.id;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      setMode(item.id);
                    }}
                    className={`flex-1 items-center justify-center rounded-xl py-2 transition-all ${
                      active ? 'bg-surface shadow-sm' : 'bg-transparent'
                    } active:scale-95`}
                  >
                    <Text
                      className={`text-xs font-semibold ${
                        active ? 'text-primary' : 'text-muted'
                      }`}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        <View className="mb-6">
          <Text className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-muted">
            {t('settings.general.language')}
          </Text>
          <Text className="mb-2 px-1 text-[11px] text-muted">{t('settings.general.languageDescription')}</Text>
          <View className="overflow-hidden rounded-3xl border border-border/80 bg-surface p-2 shadow-sm">
            <View className="gap-1">
              {languageOptions.map((code) => {
                const active = localePref === code;
                const label = code === 'system' ? t('settings.languageSystem') : LOCALE_NATIVE_NAME[code];
                return (
                  <Pressable
                    key={code}
                    onPress={() => setLocalePref(code)}
                    className={`flex-row items-center justify-between rounded-2xl px-3.5 py-3 ${
                      active ? 'bg-primary/10 border border-primary/60' : 'border border-transparent'
                    } active:scale-[0.99]`}
                  >
                    <Text className={`text-sm font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>
                      {label}
                    </Text>
                    {active ? <Glyph name="check" size={14} color={vars['--primary']} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        <View className="mb-8">
          <Text className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-muted">
            {t('mobile.settings.palettes')}
          </Text>
          <View className="overflow-hidden rounded-3xl border border-border/80 bg-surface p-3.5 shadow-sm">
            <View className="flex-row flex-wrap gap-2.5">
              {PALETTES.map((p) => {
                const active = paletteId === p.id;
                const swatches = p.swatches || [
                  p.light['--default'] || p.light['--focus'],
                  p.light['--surface-secondary'] || p.light['--accent'],
                  p.dark['--default'] || p.dark['--focus'],
                  p.dark['--surface-secondary'] || p.dark['--background']
                ];

                return (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      setPaletteId(p.id);
                    }}
                    className={`min-w-[47%] flex-1 flex-col justify-between rounded-2xl border p-3 transition-all ${
                      active
                        ? 'border-primary/80 bg-primary/10 shadow-xs'
                        : 'border-border/60 bg-surface-secondary/40'
                    } active:scale-95`}
                  >
                    <View className="flex-row items-center justify-between mb-2.5">
                      <Text className="text-xs font-bold text-foreground">{p.title}</Text>
                      {active ? (
                        <View className="rounded-full bg-primary/20 p-0.5">
                          <Glyph name="check" size={12} color={vars['--primary']} />
                        </View>
                      ) : null}
                    </View>

                    <View className="flex-row items-center gap-1.5 rounded-xl bg-surface/60 p-1.5 border border-border/40">
                      {swatches.map((color, idx) => (
                        <View
                          key={idx}
                          className="h-4 flex-1 rounded-md border border-black/10 shadow-2xs"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        <View className="h-10" />
      </ScrollView>

      <Modal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}>
        <View className="flex-1 bg-black">
          <View className="flex-row items-center justify-between px-4 pt-12 pb-4">
            <Text className="text-lg font-bold text-white">{t('mobile.settings.scanTitle')}</Text>
            <Pressable
              onPress={() => setScannerOpen(false)}
              className="rounded-full bg-white/20 px-3.5 py-1.5 active:opacity-75"
            >
              <Text className="text-xs font-semibold text-white">{t('shell.common.cancel')}</Text>
            </Pressable>
          </View>

          <View className="flex-1 overflow-hidden">
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['qr']
              }}
              onBarcodeScanned={handleBarCodeScanned}
            />
          </View>

          <View className="p-6 items-center">
            <Text className="text-center text-xs text-white/70">
              {t('mobile.settings.scanHint')}
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}
