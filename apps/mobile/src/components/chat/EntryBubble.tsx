import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clipboard, Pressable, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from 'react-native-reanimated';
import type { TranscriptEntry } from '@fast-ide/session-view';
import type { Display } from '@/bridge/display';
import { Glyph } from '@/components/glyphs';
import { mediumImpact } from '@/lib/haptics';
import { useThemeVars } from '@/theme/theme-context';
import { BriefTools } from './BriefTools';
import { ErrorEntry } from './ErrorEntry';
import { AgentToolPipeline } from './ToolPipeline';

function ThinkingPulse() {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.35, { duration: 750, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const animStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={animStyle}>
      <Glyph name="sparkles" size={14} color="#388bfd" />
    </Animated.View>
  );
}

function StreamingCursor() {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.15, { duration: 500, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    return () => cancelAnimation(opacity);
  }, [opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.Text style={animStyle} className="font-mono text-[15px] font-bold text-focus">
      {' ▍'}
    </Animated.Text>
  );
}

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
        {isStreaming ? <ThinkingPulse /> : <Glyph name="sparkles" size={14} color={vars['--muted']} />}
        <Text className={`text-[13px] ${isStreaming ? 'font-medium text-focus' : 'text-muted'}`}>
          {isStreaming ? t('mobile.chat.thinkingLive') : t('mobile.chat.thinkingDone')}
        </Text>
        <Glyph name={open ? 'chevron-down' : 'chevron-right'} size={13} color={vars['--muted']} />
      </Pressable>
      {open ? (
        <View className="mb-1 rounded-2xl border border-black/[0.04] bg-surface-secondary px-3.5 py-2.5 dark:border-white/8">
          <View className="flex-row items-stretch gap-2.5">
            <View className="w-0.5 rounded-full bg-focus/50" />
            <Text className="flex-1 text-[13px] italic leading-5 text-muted" selectable>
              {reasoning}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function EntryBubble({
  entry,
  sessionId,
  busy,
  stale,
  display,
  onCopy
}: {
  entry: TranscriptEntry;
  sessionId: string;
  busy: boolean;
  stale: boolean;
  display: Display;
  onCopy?: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const vars = useThemeVars();
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

  const handleCopy = (str?: string) => {
    const textToCopy = str ?? entry.text;
    if (!textToCopy) return;
    Clipboard.setString(textToCopy);
    mediumImpact();
    onCopy?.(t('mobile.chat.copied'));
  };

  if (entry.role === 'user') {
    return (
      <Pressable
        onLongPress={() => handleCopy()}
        className="max-w-[85%] self-end rounded-[20px] border border-black/[0.04] bg-accent px-4 py-2.5 dark:border-white/[0.08] dark:border-t-white/[0.18] active:opacity-90"
      >
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
        {isStreaming ? <StreamingCursor /> : null}
      </Text>
    ) : null;

  return (
    <View className={brief ? 'self-stretch' : 'self-stretch px-1'}>
      {!brief && entry.reasoning ? <ReasoningBox reasoning={entry.reasoning} isStreaming={isStreaming && !text} /> : null}
      {body ? (
        <Pressable
          onLongPress={() => handleCopy()}
          className={
            brief
              ? 'max-w-[88%] self-start rounded-[20px] border border-black/[0.03] bg-surface-secondary px-4 py-2.5 dark:border-white/8 active:opacity-90'
              : ''
          }
        >
          {body}
        </Pressable>
      ) : null}
      {entry.role === 'assistant' && !isStreaming && Boolean(text) && !brief ? (
        <View className="mt-1 flex-row items-center gap-1.5">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.chat.copy')}
            onPress={() => handleCopy(text)}
            className="min-h-7 flex-row items-center gap-1.5 rounded-lg px-2 py-1 active:bg-surface-secondary/70"
          >
            <Glyph name="copy" size={13} color={vars['--muted']} />
            <Text className="text-[12px] font-medium text-muted">{t('mobile.chat.copy')}</Text>
          </Pressable>
        </View>
      ) : null}
      <Tools tools={tools} />
    </View>
  );
}

export const MemoEntryBubble = memo(EntryBubble);
