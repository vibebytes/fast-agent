import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { Glyph } from '@/components/glyphs';
import { Sheet } from '@/components/shell/sheet';
import { PALETTES } from '@/theme/palettes';
import { useThemeMode, useThemeVars } from '@/theme/theme-context';
import { Group, Row } from './group';

type Mode = 'system' | 'light' | 'dark';

export function AppearanceGroup() {
  const { t } = useTranslation();
  const { mode, setMode, paletteId, scheme } = useThemeMode();
  const isDark = scheme === 'dark';
  const [palettesOpen, setPalettesOpen] = useState(false);
  const modes: { id: Mode; label: string }[] = [
    { id: 'system', label: t('settings.common.system') },
    { id: 'light', label: t('mobile.settings.themeLight') },
    { id: 'dark', label: t('mobile.settings.themeDark') }
  ];

  return (
    <>
      <Group title={t('settings.general.appearance')}>
        {/* iOS-styled refined segmented control */}
        <View className="p-2.5">
          <View className="flex-row rounded-xl bg-surface-secondary/70 p-1">
            {modes.map((item) => {
              const active = mode === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setMode(item.id)}
                  style={
                    active
                      ? {
                          shadowColor: '#000',
                          shadowOffset: { width: 0, height: 1 },
                          shadowOpacity: isDark ? 0.35 : 0.08,
                          shadowRadius: 3,
                          elevation: 2
                        }
                      : undefined
                  }
                  className={`min-h-[36px] flex-1 items-center justify-center rounded-lg ${
                    active
                      ? isDark
                        ? 'border border-white/15 bg-[#25282c]'
                        : 'border border-border/80 bg-surface'
                      : ''
                  }`}
                >
                  <Text
                    className={`text-[15px] ${
                      active ? 'font-semibold text-foreground' : 'font-normal text-muted'
                    }`}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Row
          label={t('mobile.settings.palettes')}
          icon="palette"
          badge="amber"
          value={PALETTES.find((p) => p.id === paletteId)?.title ?? paletteId}
          chevron
          onPress={() => setPalettesOpen(true)}
        />
      </Group>
      <PaletteSheet visible={palettesOpen} onClose={() => setPalettesOpen(false)} />
    </>
  );
}

function PaletteSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const { paletteId, setPaletteId } = useThemeMode();
  return (
    <Sheet visible={visible} onClose={onClose} title={t('mobile.settings.palettes')}>
      <View className="flex-row flex-wrap gap-2.5 pt-1">
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
              accessibilityRole="button"
              accessibilityLabel={p.title}
              accessibilityState={{ selected: active }}
              onPress={() => setPaletteId(p.id)}
              className={`min-w-[47%] flex-1 rounded-2xl border-2 bg-surface-secondary p-3 active:opacity-80 ${
                active ? 'border-focus' : 'border-transparent'
              }`}
            >
              <View className="mb-2 flex-row items-center justify-between">
                <Text numberOfLines={1} className="flex-1 text-[13px] font-semibold text-surface-secondary-foreground">
                  {p.title}
                </Text>
                {active ? <Glyph name="check" size={14} color={vars['--focus']} /> : null}
              </View>
              <View className="flex-row gap-1">
                {swatches.map((color, idx) => (
                  <View key={idx} className="h-4 flex-1 rounded-md" style={{ backgroundColor: color }} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}
