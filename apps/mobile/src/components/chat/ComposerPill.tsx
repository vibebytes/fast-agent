import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';

import { Glyph } from '@/components/glyphs';
import { VoiceButton } from '@/components/voice-button';
import { lightImpact } from '@/lib/haptics';
import { useThemeVars } from '@/theme/theme-context';

/** Pill input with the mic inside and a round send button that springs into view once there is text. */
export function ComposerPill({
  value,
  onChange,
  onSend,
  placeholder,
  locked = false,
  voice = false
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
  const [focused, setFocused] = useState(false);
  const Input = TextInput;
  const hasText = value.trim().length > 0;

  const appendVoice = (spoken: string) => {
    const said = spoken.trim();
    if (!said || locked) return;
    onChange(value.trim() ? `${value.trim()} ${said}` : said);
  };

  const handleSend = () => {
    if (locked) return;
    lightImpact();
    onSend();
  };

  const sendBtnStyle = useAnimatedStyle(() => ({
    width: withTiming(hasText ? 40 : 0, { duration: 180 }),
    opacity: withTiming(hasText ? 1 : 0, { duration: 150 }),
    transform: [{ scale: withSpring(hasText ? 1 : 0.4, { damping: 14, stiffness: 220 }) }]
  }));

  const isHighlighted = focused && !locked;

  return (
    <View className="flex-row items-end">
      <View
        style={{
          borderColor: isHighlighted ? vars['--focus'] : undefined,
          shadowColor: vars['--focus'],
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: isHighlighted ? 0.25 : 0,
          shadowRadius: isHighlighted ? 6 : 0
        }}
        className={`min-h-12 flex-1 flex-row items-end rounded-3xl border bg-surface-secondary pl-4 pr-1 ${
          isHighlighted
            ? 'border-focus'
            : 'border-black/[0.04] dark:border-white/10 dark:border-t-white/20'
        }`}
      >
        <Input
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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

      <Animated.View
        style={[sendBtnStyle, { overflow: 'hidden' }]}
        className="items-center justify-end"
        pointerEvents={hasText ? 'auto' : 'none'}
      >
        <Pressable
          onPress={handleSend}
          disabled={locked}
          accessibilityRole="button"
          accessibilityLabel={t('mobile.chat.sendA11y')}
          hitSlop={4}
          className="mb-1 ml-2 h-10 w-10 items-center justify-center rounded-full border border-transparent bg-default active:opacity-80 disabled:opacity-30 dark:border-t-white/30"
        >
          <Glyph name="arrow-up" size={20} color={vars['--default-foreground']} />
        </Pressable>
      </Animated.View>
    </View>
  );
}
