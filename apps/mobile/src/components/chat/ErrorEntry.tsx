import type { TranscriptEntry } from '@fast-ide/session-view';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { bridgeStore } from '@/bridge/store';
import { Glyph } from '@/components/glyphs';
import { useThemeVars } from '@/theme/theme-context';

/** A failed turn, sitting where the reply would have been: plain reason first, raw details on demand. */
export function ErrorEntry({
  entry,
  sessionId,
  busy,
  stale
}: {
  entry: TranscriptEntry;
  sessionId: string;
  busy: boolean;
  stale: boolean;
}) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const [details, setDetails] = useState(false);
  const raw = (entry.text ?? '').trim();
  const firstLine = raw.split('\n').find((line) => line.trim().length > 0)?.slice(0, 400) ?? '';
  const kind = entry.fault?.kind;
  const remedy = entry.fault?.remedy;
  const hint =
    kind === 'transport' || kind === 'availability' || kind === 'config'
      ? t(`errors.hint.${kind}`, { defaultValue: '' })
      : '';
  const reason = hint || firstLine || t('session.errorCard.title');
  const runId = entry.turnId?.trim();
  const canRetry = !stale && (entry.fault ? remedy === 'retry_same' : true) && Boolean(runId);
  const canContinue = !stale && typeof entry.fault?.acceptedTurns === 'number' && entry.fault.acceptedTurns > 0;
  const hasDetails = Boolean(kind || remedy || (raw && raw !== reason) || (entry.fault?.attempts ?? 0) > 1);

  return (
    <View
      className={`max-w-[88%] self-start rounded-[20px] bg-surface-secondary px-4 py-2.5 border ${
        stale
          ? 'border-black/[0.04] dark:border-white/8'
          : 'border-danger/25 dark:border-danger/35 dark:border-t-danger/50'
      }`}
    >
      <View className="flex-row gap-2">
        <View className="pt-0.5">
          <Glyph name="alert" size={16} color={stale ? vars['--muted'] : vars['--danger']} />
        </View>
        <Text
          className={`flex-1 text-[15px] leading-6 ${stale ? 'text-muted' : 'text-surface-secondary-foreground'}`}
          selectable
        >
          {reason}
        </Text>
      </View>

      {details ? (
        <View className="mt-1.5 gap-1 pl-6">
          {kind ? (
            <Text className="text-[13px] text-muted">
              {t('session.errorCard.kind')}: {t(`errors.kind.${kind}`, { defaultValue: kind })}
            </Text>
          ) : null}
          {remedy ? (
            <Text className="text-[13px] text-muted">
              {t('session.errorCard.remedy')}: {t(`errors.remedy.${remedy}`, { defaultValue: remedy })}
            </Text>
          ) : null}
          {(entry.fault?.attempts ?? 0) > 1 ? (
            <Text className="text-[13px] text-muted">
              {t('session.errorCard.attempts', { attempts: entry.fault?.attempts })}
            </Text>
          ) : null}
          {raw ? (
            <Text className="font-mono text-[11px] leading-4 text-muted" selectable>
              {raw}
            </Text>
          ) : null}
        </View>
      ) : null}

      {hasDetails || canRetry || canContinue ? (
        <View className="flex-row flex-wrap items-center justify-end gap-x-1 pl-6">
          {hasDetails ? (
            <TextAction label={details ? t('mobile.chat.hideDetails') : t('mobile.chat.details')} onPress={() => setDetails((v) => !v)} muted />
          ) : null}
          {canRetry && runId ? (
            <TextAction label={t('session.errorCard.retry')} disabled={busy} onPress={() => bridgeStore.rerunRun(sessionId, runId)} />
          ) : null}
          {canContinue ? (
            <TextAction label={t('session.errorCard.continue')} disabled={busy} onPress={() => bridgeStore.continueRun(sessionId)} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function TextAction({
  label,
  onPress,
  disabled,
  muted
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  muted?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className="min-h-11 justify-center px-2 active:opacity-60 disabled:opacity-30"
    >
      <Text className={`text-[13px] font-semibold ${muted ? 'text-muted' : 'text-link'}`}>{label}</Text>
    </Pressable>
  );
}
