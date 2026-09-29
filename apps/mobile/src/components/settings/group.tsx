import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';

import { Glyph } from '@/components/glyphs';
import { Hairline } from '@/components/shell/sheet';
import { useThemeVars } from '@/theme/theme-context';

/** iOS-style grouped section: muted title, one surface card, hairlines between rows. */
export function Group({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View className="mb-6">
      {title ? <Text className="mb-1.5 px-4 text-[13px] text-muted">{title}</Text> : null}
      <View className="overflow-hidden rounded-2xl bg-surface-secondary">
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 ? (
              <View className="pl-4">
                <Hairline />
              </View>
            ) : null}
            {row}
          </Fragment>
        ))}
      </View>
      {footer ? <Text className="mt-1.5 px-4 text-[13px] leading-5 text-muted">{footer}</Text> : null}
    </View>
  );
}

export function Row({
  label,
  detail,
  value,
  onPress,
  checked,
  chevron,
  tone = 'default',
  right
}: {
  label: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  checked?: boolean;
  chevron?: boolean;
  tone?: 'default' | 'danger' | 'link';
  right?: ReactNode;
}) {
  const vars = useThemeVars();
  const color = tone === 'danger' ? 'text-danger' : tone === 'link' ? 'text-link' : 'text-surface-secondary-foreground';
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      className="min-h-11 flex-row items-center gap-3 px-4 py-2.5 active:opacity-60"
    >
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className={`text-[15px] ${color}`}>
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={1} className="mt-0.5 text-[13px] text-muted">
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text numberOfLines={1} className="max-w-[50%] text-[15px] text-muted">
          {value}
        </Text>
      ) : null}
      {right}
      {checked ? <Glyph name="check" size={16} color={vars['--link']} /> : null}
      {chevron ? <Glyph name="chevron-right" size={14} color={vars['--muted']} /> : null}
    </Pressable>
  );
}

/** A text field that lives in a row. */
export function FieldRow({ label, mono, ...input }: TextInputProps & { label: string; mono?: boolean }) {
  const vars = useThemeVars();
  return (
    <View className="min-h-11 flex-row items-center gap-3 px-4">
      <Text className="w-20 text-[15px] text-surface-secondary-foreground">{label}</Text>
      <TextInput
        placeholderTextColor={vars['--muted']}
        autoCapitalize="none"
        autoCorrect={false}
        {...input}
        className={`min-h-11 flex-1 py-2.5 text-[15px] text-surface-secondary-foreground ${mono ? 'font-mono' : ''}`}
      />
    </View>
  );
}
