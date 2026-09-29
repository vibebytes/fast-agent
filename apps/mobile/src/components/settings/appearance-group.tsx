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
  const { mode, setMode, paletteId } = useThemeMode();
  const [palettesOpen, setPalettesOpen] = useState(false);
  const modes: { id: Mode; label: string }[] = [
    { id: 'system', label: t('settings.common.system') },
    { id: 'light', label: t('mobile.settings.themeLight') },
    { id: 'dark', label: t('mobile.settings.themeDark') }
  ];

  return (
    <>
      <Group title={t('settings.general.appearance')}>
        <View className="flex-row gap-1 p-1.5">
          {modes.map((item) => {
            const active = mode === item.id;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setMode(item.id)}
                className={`min-h-11 flex-1 items-center justify-center rounded-xl ${active ? 'bg-surface' : ''}`}
              >
                <Text className={`text-[15px] ${active ? 'font-semibold text-surface-foreground' : 'text-muted'}`}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Row
          label={t('mobile.settings.palettes')}
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
