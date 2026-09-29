import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import type { StatusLine as Line } from '@/bridge/status-line';
import { Glyph } from '@/components/glyphs';
import { useThemeVars } from '@/theme/theme-context';

/** At most one quiet line above the composer; "running" opens the run sheet and hosts the Stop button. */
export function StatusLine({
  line,
  onOpenRun,
  stop
}: {
  line: Line | null;
  onOpenRun: () => void;
  stop?: ReactNode;
}) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  if (!line) return null;

  const text =
    line.kind === 'offline'
      ? t('mobile.chat.lockedDisconnected')
      : line.kind === 'lease'
        ? line.notice.startsWith('errors.') || line.notice.startsWith('shell.')
          ? t(line.notice)
          : line.notice
        : line.kind === 'decision'
          ? t('mobile.chat.lockedDecision')
          : line.kind === 'queued'
            ? t('mobile.chat.queued')
            : line.stopping
              ? t('mobile.chat.agentStopping')
              : t('mobile.chat.agentRunning');
  const warn = line.kind === 'offline' || line.kind === 'lease';
  const running = line.kind === 'running';

  return (
    <View className="min-h-9 flex-row items-center pl-5 pr-3">
      <Pressable
        accessibilityRole={running ? 'button' : 'text'}
        accessibilityLabel={running ? t('mobile.chat.runA11y') : undefined}
        disabled={!running}
        onPress={onOpenRun}
        className="min-h-9 flex-1 flex-row items-center gap-1.5 active:opacity-60"
      >
        <Glyph
          name={warn ? 'alert' : running ? 'sparkles' : 'history'}
          size={14}
          color={warn ? vars['--warning'] : vars['--muted']}
        />
        <Text numberOfLines={1} className="flex-1 text-[13px] text-muted">
          {text}
        </Text>
        {running && !stop ? <Glyph name="chevron-right" size={13} color={vars['--muted']} /> : null}
      </Pressable>
      {running ? stop : null}
    </View>
  );
}
