import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';

import { Glyph } from '@/components/glyphs';
import { VoiceButton } from '@/components/voice-button';
import { useThemeVars } from '@/theme/theme-context';

/** Pill input with the mic inside and a round send button that only appears once there is text. */
export function ComposerPill({
  value,
  onChange,
  onSend,
  placeholder,
  locked = false,
  voice = false,
  inSheet = false
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  placeholder: string;
  locked?: boolean;
  voice?: boolean;
  inSheet?: boolean;
}) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const Input = inSheet ? BottomSheetTextInput : TextInput;
  const hasText = value.trim().length > 0;
  const appendVoice = (spoken: string) => {
    const said = spoken.trim();
    if (!said || locked) return;
    onChange(value.trim() ? `${value.trim()} ${said}` : said);
  };

  return (
    <View className="flex-row items-end gap-2">
      <View className="min-h-12 flex-1 flex-row items-end rounded-3xl bg-surface-secondary pl-4 pr-1">
        <Input
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={vars['--muted']}
          editable={!locked}
          multiline
          numberOfLines={6}
          style={{ maxHeight: 6 * 22 + 24 }}
          className="min-h-12 flex-1 py-3 text-[15px] leading-[22px] text-surface-secondary-foreground"
        />
        {voice ? (
          <View className="pb-0.5">
            <VoiceButton onResult={appendVoice} disabled={locked} inline />
          </View>
        ) : null}
      </View>
      {hasText ? (
        <Pressable
          onPress={onSend}
          disabled={locked}
          accessibilityRole="button"
          accessibilityLabel={t('mobile.chat.sendA11y')}
          hitSlop={4}
          className="mb-1 h-10 w-10 items-center justify-center rounded-full bg-default active:opacity-80 disabled:opacity-30"
        >
          <Glyph name="arrow-up" size={20} color={vars['--default-foreground']} />
        </Pressable>
      ) : null}
    </View>
  );
}
