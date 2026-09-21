import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clipboard, Pressable, Text, View } from 'react-native';
import type { TranscriptEntry } from '@fast-ide/session-view';
import { bridgeStore } from '@/bridge/store';
import { Glyph } from '@/components/glyphs';
import { useThemeVars } from '@/theme/theme-context';
import { AgentToolPipeline } from './ToolPipeline';

export function ReasoningBox({ reasoning, isStreaming }: { reasoning: string; isStreaming: boolean }) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const [open, setOpen] = useState(false);

  return (
    <View className="mb-2.5 overflow-hidden rounded-2xl border border-border/70 bg-surface-secondary/40 shadow-xs">
      <Pressable
        onPress={() => setOpen(!open)}
        className="flex-row items-center justify-between px-3.5 py-2 active:bg-surface-secondary/70"
      >
        <View className="flex-row items-center gap-2">
          {isStreaming ? (
            <View className="h-2 w-2 animate-ping rounded-full bg-primary" />
          ) : (
            <Glyph name="sparkles" size={13} color={vars['--muted']} />
          )}
          <Text className="text-xs font-medium text-muted">
            {isStreaming ? t('mobile.chat.thinkingLive') : t('mobile.chat.thinkingDone')}
          </Text>
        </View>
        <Glyph name={open ? 'chevron-down' : 'chevron-right'} size={13} color={vars['--muted']} />
      </Pressable>
      {open ? (
        <View className="border-t border-border/40 bg-surface/60 px-3.5 py-2.5">
          <Text className="font-sans text-xs italic leading-5 text-muted" selectable>
            {reasoning}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function MessageActionBar({ text }: { text?: string }) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const [copied, setCopied] = useState(false);

  if (!text) return null;

  const handleCopy = () => {
    Clipboard.setString(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <View className="mt-2 flex-row items-center gap-3 self-start px-1">
      <Pressable
        onPress={handleCopy}
        className="flex-row items-center gap-1 rounded-lg bg-surface-secondary/70 px-2 py-1 active:opacity-75"
      >
        <Text className="text-[10px] text-muted">{copied ? t('mobile.chat.copied') : t('mobile.chat.copy')}</Text>
      </Pressable>
    </View>
  );
}

export function EntryBubble({
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
  const isUser = entry.role === 'user';
  const tools = entry.tools ?? [];
  const isStreaming = entry.status === 'streaming';
  const isError = entry.status === 'error';

  if (isError) {
    const rawText = (entry.text ?? '').trim();
    const firstLine = rawText.split('\n').find((line) => line.trim().length > 0);
    const summary = firstLine?.slice(0, 400) ?? '';
    const kind = entry.fault?.kind;
    const remedy = entry.fault?.remedy;
    const friendlyHint =
      kind === 'transport' || kind === 'availability' || kind === 'config'
        ? t(`errors.hint.${kind}`, { defaultValue: '' })
        : '';
    const primary = friendlyHint || summary;
    const retryable = entry.fault ? entry.fault.remedy === 'retry_same' : true;
    const runId = entry.turnId?.trim();
    return (
      <View className="mb-5 self-stretch overflow-hidden rounded-2xl border border-destructive/40 bg-destructive/10 px-3.5 py-3">
        <Text className="text-sm font-semibold text-destructive">{t('session.errorCard.title')}</Text>
        {kind ? (
          <Text className="mt-1 text-xs text-muted">
            {t('session.errorCard.kind')}: {t(`errors.kind.${kind}`, { defaultValue: kind })}
          </Text>
        ) : null}
        {primary ? (
          <Text className="mt-1.5 font-mono text-xs leading-5 text-foreground" selectable>
            {primary}
          </Text>
        ) : null}
        {remedy ? (
          <Text className="mt-2 text-xs font-medium text-warning">
            {t('session.errorCard.remedy')}: {t(`errors.remedy.${remedy}`, { defaultValue: remedy })}
          </Text>
        ) : null}
        {typeof entry.fault?.attempts === 'number' && entry.fault.attempts > 1 ? (
          <Text className="mt-1 text-[11px] text-muted">
            {t('session.errorCard.attempts', { attempts: entry.fault.attempts })}
          </Text>
        ) : null}
        {stale ? null : (
          <View className="mt-3 flex-row flex-wrap gap-2">
            {retryable && runId ? (
              <Pressable
                disabled={busy}
                onPress={() => bridgeStore.rerunRun(sessionId, runId)}
                className="rounded-lg border border-destructive/40 bg-background px-3 py-1.5 active:opacity-75 disabled:opacity-30"
              >
                <Text className="text-xs font-medium text-foreground">{t('session.errorCard.retry')}</Text>
              </Pressable>
            ) : null}
            {typeof entry.fault?.acceptedTurns === 'number' && entry.fault.acceptedTurns > 0 ? (
              <Pressable
                disabled={busy}
                onPress={() => bridgeStore.continueRun(sessionId)}
                className="rounded-lg border border-destructive/40 bg-background px-3 py-1.5 active:opacity-75 disabled:opacity-30"
              >
                <Text className="text-xs font-medium text-foreground">{t('session.errorCard.continue')}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        <AgentToolPipeline tools={tools} />
      </View>
    );
  }

  return (
    <View
      className={
        isUser
          ? 'mb-4 max-w-[85%] self-end rounded-2xl rounded-tr-xs bg-default px-4 py-3 shadow-xs active:scale-[0.99]'
          : 'mb-5 self-stretch px-1'
      }
    >
      {/* Agent Thinking Box */}
      {entry.reasoning ? (
        <ReasoningBox reasoning={entry.reasoning} isStreaming={isStreaming && !entry.text} />
      ) : null}

      {/* Main Content */}
      {entry.text ? (
        <Text
          className={
            isUser
              ? 'text-[15px] font-normal leading-6 text-default-foreground'
              : 'text-[15px] font-normal leading-7 text-foreground'
          }
          selectable
        >
          {entry.text}
        </Text>
      ) : null}

      {/* Streaming pulse placeholder */}
      {isStreaming && !entry.text && tools.length === 0 && !entry.reasoning ? (
        <View className="flex-row items-center gap-2 py-1">
          <View className="h-2 w-2 animate-ping rounded-full bg-primary" />
          <Text className="text-xs text-muted">{t('mobile.chat.preparing')}</Text>
        </View>
      ) : null}

      {isStreaming && entry.text ? (
        <View className="mt-1.5 flex-row items-center gap-1.5">
          <View className="h-3.5 w-[2px] animate-pulse rounded-full bg-primary" />
          <Text className="text-[10px] font-medium text-muted">{t('mobile.chat.generating')}</Text>
        </View>
      ) : null}

      {/* Agent Tool Calling Pipeline */}
      <AgentToolPipeline tools={tools} />

      {/* Action Bar for Assistant */}
      {!isUser && entry.text ? <MessageActionBar text={entry.text} /> : null}
    </View>
  );
}


export const MemoEntryBubble = memo(EntryBubble);
