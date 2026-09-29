import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clipboard, Pressable, Text, View } from 'react-native';
import type { TranscriptEntry } from '@fast-ide/session-view';
import type { Display } from '@/bridge/display';
import { Glyph } from '@/components/glyphs';
import { useThemeVars } from '@/theme/theme-context';
import { BriefTools } from './BriefTools';
import { ErrorEntry } from './ErrorEntry';
import { AgentToolPipeline } from './ToolPipeline';

export function ReasoningBox({ reasoning, isStreaming }: { reasoning: string; isStreaming: boolean }) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const [open, setOpen] = useState(false);

  return (
    <View className="mb-1.5">
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(!open)}
        className="min-h-11 flex-row items-center gap-1.5 self-start pr-2 active:opacity-60"
      >
        <Glyph name="sparkles" size={14} color={vars['--muted']} />
        <Text className="text-[13px] text-muted">
          {isStreaming ? t('mobile.chat.thinkingLive') : t('mobile.chat.thinkingDone')}
        </Text>
        <Glyph name={open ? 'chevron-down' : 'chevron-right'} size={13} color={vars['--muted']} />
      </Pressable>
      {open ? (
        <View className="rounded-2xl bg-surface-secondary px-3.5 py-2.5">
          <Text className="text-[13px] italic leading-5 text-muted" selectable>
            {reasoning}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Streaming shows a still block at the end of the text — no pulsing, no "generating" caption. */
const CURSOR = ' ▍';

export function EntryBubble({
  entry,
  sessionId,
  busy,
  stale,
  display
}: {
  entry: TranscriptEntry;
  sessionId: string;
  busy: boolean;
  stale: boolean;
  display: Display;
}) {
  const tools = entry.tools ?? [];
  const isStreaming = entry.status === 'streaming';
  const brief = display === 'brief';
  const Tools = brief ? BriefTools : AgentToolPipeline;

  if (entry.status === 'error') {
    return (
      <View>
        <ErrorEntry entry={entry} sessionId={sessionId} busy={busy} stale={stale} />
        <Tools tools={tools} />
      </View>
    );
  }

  const copy = () => {
    if (entry.text) Clipboard.setString(entry.text);
  };

  if (entry.role === 'user') {
    return (
      <Pressable onLongPress={copy} className="max-w-[85%] self-end rounded-[20px] bg-accent px-4 py-2.5">
        <Text className="text-[15px] leading-6 text-accent-foreground" selectable>
          {entry.text}
        </Text>
      </Pressable>
    );
  }

  const text = entry.text ?? '';
  const waiting = isStreaming && !text && tools.length === 0;
  const body =
    text || waiting ? (
      <Text
        className={`text-[15px] leading-6 ${brief ? 'text-surface-secondary-foreground' : 'text-foreground'}`}
        selectable
      >
        {text}
        {isStreaming ? <Text className="text-muted">{CURSOR}</Text> : null}
      </Text>
    ) : null;

  return (
    <View className={brief ? 'self-stretch' : 'self-stretch px-1'}>
      {!brief && entry.reasoning ? <ReasoningBox reasoning={entry.reasoning} isStreaming={isStreaming && !text} /> : null}
      {body ? (
        <Pressable
          onLongPress={copy}
          className={brief ? 'max-w-[88%] self-start rounded-[20px] bg-surface-secondary px-4 py-2.5' : ''}
        >
          {body}
        </Pressable>
      ) : null}
      <Tools tools={tools} />
    </View>
  );
}

export const MemoEntryBubble = memo(EntryBubble);
