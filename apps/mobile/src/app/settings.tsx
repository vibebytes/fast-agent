import { useState, useEffect } from 'react';
import { Alert, Modal, Pressable, ScrollView, TextInput, View, Text } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { parsePairingPayload } from '@/bridge/pairing';
import { bridgeStore } from '@/bridge/store';
import { loadBridgeConfig, type SavedServer } from '@/bridge/config';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { ConnectionBanner } from '@/components/connection';
import { GlassHeader } from '@/components/glass-header';
import { Glyph } from '@/components/glyphs';
import { PALETTES } from '@/theme/palettes';
import { useThemeMode, useThemeVars } from '@/theme/theme-context';

export default function SettingsScreen() {
  const vars = useThemeVars();
  const { mode, setMode, paletteId, setPaletteId } = useThemeMode();
  const snapshot = useBridgeSnapshot();
  const [permission, requestPermission] = useCameraPermissions();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [showAddServer, setShowAddServer] = useState(false);
  
  const [servers, setServers] = useState<SavedServer[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);

  const [newUrl, setNewUrl] = useState('');
  const [newToken, setNewToken] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const refreshServers = async () => {
    const config = await loadBridgeConfig();
    setServers(config.servers);
    setActiveServerId(config.activeServerId);
  };

  useEffect(() => {
    refreshServers();
  }, [snapshot.connection]);

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    setScannerOpen(false);
    const parsedPayload = parsePairingPayload(data);
    if (parsedPayload) {
      await bridgeStore.saveServer({
        id: `srv-${Date.now()}`,
        serverUrl: parsedPayload.serverUrl,
        token: parsedPayload.token,
        label: '扫码配对服务器',
        fingerprint: parsedPayload.fingerprint ?? undefined
      });
      await refreshServers();
      Alert.alert('配对成功', `已添加服务器：${parsedPayload.serverUrl}`);
      return;
    }
    Alert.alert('配对失败', '无法识别该二维码，请使用桌面端生成的有效配对码。');
  };

  const openScanner = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert('需要权限', '请在系统设置中允许使用相机以扫描配对二维码。');
        return;
      }
    }
    setScannerOpen(true);
  };

  const handleManualAdd = async () => {
    if (!newUrl.trim() || !newToken.trim()) {
      Alert.alert('提示', '请完整填写服务器地址和访问令牌');
      return;
    }
    await bridgeStore.saveServer({
      id: `srv-${Date.now()}`,
      serverUrl: newUrl.trim(),
      token: newToken.trim(),
      label: newLabel.trim() || '手动添加'
    });
    setNewUrl('');
    setNewToken('');
    setNewLabel('');
    setShowAddServer(false);
    await refreshServers();
  };

  const handleDeleteServer = async (id: string) => {
    await bridgeStore.deleteServer(id);
    await refreshServers();
  };

  const handleSelectServer = async (id: string) => {
    await bridgeStore.setActiveServer(id);
    await refreshServers();
  };

  const isConnected = snapshot.connection === 'open';

  return (
    <View className="flex-1 bg-background">
      <ConnectionBanner />
      <GlassHeader className="flex-row items-center justify-between border-b border-border/70 px-4 py-3.5">
        <View>
          <Text className="text-xl font-bold tracking-tight text-foreground">偏好设置</Text>
          <Text className="text-[11px] font-medium text-muted">服务连接与视觉定制</Text>
        </View>
      </GlassHeader>

      <ScrollView className="flex-1 px-4 pt-4" showsVerticalScrollIndicator={false}>
        {/* Section 1: Server & Bridge */}
        <View className="mb-6">
          <Text className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-muted">
            桌面端服务连接 (Bridge)
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
                      {servers.find((s) => s.id === activeServerId)?.label || '未选择活动服务器'}
                    </Text>
                    <Text className="text-xs text-muted">
                      {isConnected ? '实时同步已就绪' : '未连接到服务'}
                    </Text>
                  </View>
                </View>

                <Pressable
                  onPress={openScanner}
                  className="flex-row items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 active:scale-95 shadow-sm"
                >
                  <Glyph name="sparkles" size={13} color={vars['--primary-foreground']} />
                  <Text className="text-xs font-semibold text-primary-foreground">扫码配对</Text>
                </Pressable>
              </View>

              {/* Server List */}
              {servers.length > 0 ? (
                <View className="mt-4 gap-2 border-t border-border/50 pt-3">
                  {servers.map((server) => {
                    const isSelected = server.id === activeServerId;
                    return (
                      <Pressable
                        key={server.id}
                        onPress={() => handleSelectServer(server.id)}
                        className={`flex-row items-center justify-between rounded-2xl p-3.5 transition-all ${
                          isSelected
                            ? 'border border-primary/60 bg-primary/10 shadow-xs'
                            : 'border border-border/50 bg-surface-secondary/40'
                        } active:scale-[0.985]`}
                      >
                        <View className="flex-1 pr-2">
                          <Text className="text-xs font-bold text-foreground">{server.label}</Text>
                          <Text numberOfLines={1} className="mt-0.5 font-mono text-[11px] text-muted">
                            {server.serverUrl}
                          </Text>
                        </View>
                        <View className="flex-row items-center gap-2">
                          {isSelected ? (
                            <View className="rounded-full bg-primary px-2.5 py-0.5">
                              <Text className="text-[10px] font-bold text-primary-foreground">活跃</Text>
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

              {/* Add Manual Form Toggle */}
              <Pressable
                onPress={() => {
                  setShowAddServer(!showAddServer);
                }}
                className="mt-3.5 items-center justify-center py-1 active:opacity-75"
              >
                <Text className="text-xs font-semibold text-primary">
                  {showAddServer ? '收起手动配置' : '+ 手动配置服务器地址与 Token'}
                </Text>
              </Pressable>

              {showAddServer ? (
                <View className="mt-3 gap-2.5 rounded-2xl border border-border bg-surface-secondary/50 p-3.5">
                  <TextInput
                    value={newLabel}
                    onChangeText={setNewLabel}
                    placeholder="服务器备注 (如：MacBook Pro)"
                    placeholderTextColor={vars['--muted']}
                    className="rounded-xl border border-border bg-surface px-3 py-2.5 text-xs text-foreground"
                  />
                  <TextInput
                    value={newUrl}
                    onChangeText={setNewUrl}
                    placeholder="WebSocket 地址 (如：ws://192.168.1.5:4040/ws)"
                    placeholderTextColor={vars['--muted']}
                    autoCapitalize="none"
                    className="rounded-xl border border-border bg-surface px-3 py-2.5 text-xs font-mono text-foreground"
                  />
                  <TextInput
                    value={newToken}
                    onChangeText={setNewToken}
                    placeholder="安全访问令牌 (Token)"
                    placeholderTextColor={vars['--muted']}
                    autoCapitalize="none"
                    className="rounded-xl border border-border bg-surface px-3 py-2.5 text-xs font-mono text-foreground"
                  />
                  <Pressable
                    onPress={handleManualAdd}
                    className="mt-1 items-center justify-center rounded-xl bg-primary py-2.5 active:scale-95 shadow-sm"
                  >
                    <Text className="text-xs font-semibold text-primary-foreground">保存并连接</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* Section 2: Appearance & Mode */}
        <View className="mb-6">
          <Text className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-muted">
            显示模式 (Appearance)
          </Text>
          <View className="overflow-hidden rounded-3xl border border-border/80 bg-surface p-2 shadow-sm">
            <View className="flex-row gap-1.5 bg-surface-secondary/60 p-1 rounded-2xl border border-border/40">
              {(
                [
                  { id: 'system', label: '跟随系统' },
                  { id: 'light', label: '浅色' },
                  { id: 'dark', label: '深色' }
                ] as const
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

        {/* Section 3: Palette Selector */}
        <View className="mb-8">
          <Text className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-muted">
            配色主题 (Theme Palettes)
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

                    {/* Rich Color Swatches Palette Preview */}
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

      {/* QR Scanner Modal */}
      <Modal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}>
        <View className="flex-1 bg-black">
          <View className="flex-row items-center justify-between px-4 pt-12 pb-4">
            <Text className="text-lg font-bold text-white">扫描配对二维码</Text>
            <Pressable
              onPress={() => setScannerOpen(false)}
              className="rounded-full bg-white/20 px-3.5 py-1.5 active:opacity-75"
            >
              <Text className="text-xs font-semibold text-white">取消</Text>
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
              请对准桌面端设置或控制台生成的配对二维码
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}
