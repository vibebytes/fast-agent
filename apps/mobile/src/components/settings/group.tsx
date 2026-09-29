import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';

import { Glyph, type GlyphName } from '@/components/glyphs';
import { Hairline } from '@/components/shell/sheet';
import { useThemeMode, useThemeVars } from '@/theme/theme-context';

export type BadgeColor = 'blue' | 'purple' | 'green' | 'amber' | 'teal' | 'gray';

export const BADGE_PALETTE: Record<BadgeColor, { bgLight: string; bgDark: string; fgLight: string; fgDark: string }> = {
  blue: { bgLight: '#e6f0fe', bgDark: 'rgba(56, 189, 248, 0.16)', fgLight: '#0d6efd', fgDark: '#38bdf8' },
  purple: { bgLight: '#f1ebfe', bgDark: 'rgba(168, 85, 247, 0.16)', fgLight: '#7c3aed', fgDark: '#c084fc' },
  green: { bgLight: '#e1f7ec', bgDark: 'rgba(74, 222, 128, 0.16)', fgLight: '#0f9956', fgDark: '#4ade80' },
  amber: { bgLight: '#fef3dc', bgDark: 'rgba(251, 191, 36, 0.16)', fgLight: '#d97706', fgDark: '#fbbf24' },
  teal: { bgLight: '#ddf7f3', bgDark: 'rgba(45, 212, 191, 0.16)', fgLight: '#0d9488', fgDark: '#2dd4bf' },
  gray: { bgLight: '#edf0f4', bgDark: 'rgba(148, 163, 184, 0.16)', fgLight: '#57626d', fgDark: '#94a3b8' }
};

/** iOS-style elevated card group: crisp border, subtle elevation, and refined title rhythm. */
export function Group({
  title,
  headerRight,
  footer,
  children
}: {
  title?: ReactNode;
  headerRight?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { scheme } = useThemeMode();
  const isDark = scheme === 'dark';
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View className="mb-6">
      {title || headerRight ? (
        <View className="mb-2 flex-row items-center justify-between px-4">
          {typeof title === 'string' ? (
            <Text className="text-[13px] font-semibold text-muted">{title}</Text>
          ) : (
            title
          )}
          {headerRight}
        </View>
      ) : null}
      <View
        style={{
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: isDark ? 2 : 1 },
          shadowOpacity: isDark ? 0.35 : 0.04,
          shadowRadius: isDark ? 6 : 8,
          elevation: isDark ? 2 : 1
        }}
        className="overflow-hidden rounded-2xl border border-black/[0.04] dark:border-white/10 dark:border-t-white/20 bg-surface"
      >
        {rows.map((row, i) => {
          if (i === 0) return <Fragment key={i}>{row}</Fragment>;

          const prevRow = rows[i - 1];
          const isRow = (n: any) =>
            isValidElement(n) && ((n.props as any)?.label !== undefined || (n.props as any)?.server !== undefined);
          const bothStandardRows = isRow(prevRow) && isRow(row);

          const hasIcon = isValidElement(row) && Boolean((row.props as any)?.icon || (row.props as any)?.server);
          // 仅在相邻的两行均为标准行时，分割线与下一行文字首字起始对齐；
          // 若存在全宽自定义组件（如分段选择器或独立块），使用全宽分割线贯穿，避免视觉割裂或残缺
          const indentClass = !bothStandardRows ? '' : hasIcon ? 'pl-[58px]' : 'pl-4';

          return (
            <Fragment key={i}>
              <View className={indentClass}>
                <Hairline />
              </View>
              {row}
            </Fragment>
          );
        })}
      </View>
      {footer ? (
        typeof footer === 'string' ? (
          <Text className="mt-2 px-4 text-[13px] leading-relaxed text-muted">{footer}</Text>
        ) : (
          <View className="mt-2 px-4">{footer}</View>
        )
      ) : null}
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
  right,
  icon,
  badge = 'gray',
  iconColor,
  iconBg
}: {
  label: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  checked?: boolean;
  chevron?: boolean;
  tone?: 'default' | 'danger' | 'link';
  right?: ReactNode;
  icon?: GlyphName;
  badge?: BadgeColor;
  iconColor?: string;
  iconBg?: string;
}) {
  const vars = useThemeVars();
  const { scheme } = useThemeMode();
  const isDark = scheme === 'dark';
  const badgeDef = BADGE_PALETTE[badge];
  const bg = iconBg ?? (isDark ? badgeDef.bgDark : badgeDef.bgLight);
  const fg = iconColor ?? (isDark ? badgeDef.fgDark : badgeDef.fgLight);
  const color = tone === 'danger' ? 'text-danger' : tone === 'link' ? 'text-link' : 'text-foreground';

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      className="min-h-[52px] flex-row items-center gap-3 px-4 py-2.5 active:bg-surface-secondary/40"
    >
      {icon ? (
        <View
          style={{ backgroundColor: bg }}
          className="h-[30px] w-[30px] items-center justify-center rounded-[9px] border border-black/[0.04] dark:border-white/[0.06]"
        >
          <Glyph name={icon} size={16} color={fg} />
        </View>
      ) : null}
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className={`text-[16px] font-medium ${color}`}>
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={2} className="mt-0.5 text-[13px] leading-snug text-muted">
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
      {chevron && !right ? <Glyph name="chevron-right" size={14} color={vars['--muted']} /> : null}
    </Pressable>
  );
}

/** A text field that lives in a row. */
export function FieldRow({
  label,
  mono,
  icon,
  badge = 'gray',
  iconColor,
  iconBg,
  ...input
}: TextInputProps & {
  label: string;
  mono?: boolean;
  icon?: GlyphName;
  badge?: BadgeColor;
  iconColor?: string;
  iconBg?: string;
}) {
  const vars = useThemeVars();
  const { scheme } = useThemeMode();
  const isDark = scheme === 'dark';
  const badgeDef = BADGE_PALETTE[badge];
  const bg = iconBg ?? (isDark ? badgeDef.bgDark : badgeDef.bgLight);
  const fg = iconColor ?? (isDark ? badgeDef.fgDark : badgeDef.fgLight);

  return (
    <View className="min-h-[52px] flex-row items-center gap-3 px-4">
      {icon ? (
        <View
          style={{ backgroundColor: bg }}
          className="h-[30px] w-[30px] items-center justify-center rounded-[9px] border border-black/[0.04] dark:border-white/[0.06]"
        >
          <Glyph name={icon} size={16} color={fg} />
        </View>
      ) : null}
      <Text className="min-w-[68px] text-[16px] font-medium text-foreground">{label}</Text>
      <TextInput
        placeholderTextColor={vars['--muted']}
        autoCapitalize="none"
        autoCorrect={false}
        {...input}
        className={`min-h-[48px] flex-1 py-2 text-right text-[16px] text-foreground ${mono ? 'font-mono text-[14px]' : ''}`}
      />
    </View>
  );
}
