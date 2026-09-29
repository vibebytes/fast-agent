import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { Glyph } from '@/components/glyphs';
import { FingerprintSheet, Scanner } from '@/components/settings/pairing';
import { useServers } from '@/components/settings/use-servers';
import { AmbientGlow, Avatar } from '@/components/shell/avatar';
import { useThemeMode, useThemeVars } from '@/theme/theme-context';

export function DisconnectedState({ bottomSpace = 0 }: { bottomSpace?: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const vars = useThemeVars();
  const { scheme } = useThemeMode();
  const isDark = scheme === 'dark';
  const s = useServers();

  return (
    <View
      className="flex-1 items-center justify-center px-8"
      style={{ paddingBottom: bottomSpace }}
    >
      {/* Medallion with subtle ambient glow in dark mode */}
      <View className="items-center justify-center">
        {isDark ? <AmbientGlow size={130} opacity={0.28} /> : null}
        <Avatar size={56} />
      </View>

      <Text className="mt-5 text-center text-[16px] font-medium leading-snug text-foreground">
        {t('mobile.index.emptyClosed')}
      </Text>
      <Text className="mt-1 text-center text-[13px] text-muted">
        {t('mobile.settings.scanHint')}
      </Text>

      {/* Primary Hero CTA: Scan to pair directly without page hops */}
      <View className="mt-6 w-full max-w-[260px] items-center gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.settings.scanPair')}
          onPress={() => void s.openScanner()}
          style={{
            shadowColor: '#388bfd',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: isDark ? 0.35 : 0.15,
            shadowRadius: 6,
            elevation: 3
          }}
          className="min-h-[48px] w-full flex-row items-center justify-center gap-2.5 rounded-2xl bg-default px-5 active:opacity-85 border border-transparent dark:border-t-white/30"
        >
          <Glyph name="qr" size={18} color={vars['--default-foreground']} />
          <Text className="text-[15px] font-semibold text-default-foreground">
            {t('mobile.settings.scanPair')}
          </Text>
        </Pressable>

        {/* Secondary subtle action to go to Settings */}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/settings')}
          className="min-h-[38px] flex-row items-center gap-1.5 px-3 active:opacity-60"
        >
          <Glyph name="settings" size={14} color={vars['--muted']} />
          <Text className="text-[13px] font-medium text-muted">
            {t('mobile.index.goSettings')}
          </Text>
          <Glyph name="chevron-right" size={12} color={vars['--muted']} />
        </Pressable>
      </View>

      <Scanner visible={s.scannerOpen} onClose={() => s.setScannerOpen(false)} onScanned={(r) => void s.scanned(r)} />
      <FingerprintSheet prompt={s.finger} onAnswer={s.answerFinger} />
    </View>
  );
}
