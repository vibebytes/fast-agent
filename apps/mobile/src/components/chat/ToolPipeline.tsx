import {
  countDiffStats,
  parseDiffWithLineNumbers,
  type DiffLine
} from '@fast-ide/session-view';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassHeader } from '@/components/glass-header';
import { Glyph } from '@/components/glyphs';
import { Sheet } from '@/components/shell/sheet';
import { lightImpact } from '@/lib/haptics';
import { FastThemeScope, useThemeVars } from '@/theme/theme-context';

export type ToolLike = {
  id: string;
  tool: string;
  args?: Record<string, string>;
  output?: string;
  status: string;
  statusNote?: string;
};

type ToolCat = 'shell' | 'file' | 'search' | 'git' | 'agent' | 'system';

const TOOL_COPY: Record<ToolCat, string> = {
  shell: 'mobile.chat.toolShell',
  file: 'mobile.chat.toolFile',
  search: 'mobile.chat.toolSearch',
  git: 'mobile.chat.toolGit',
  agent: 'mobile.chat.toolAgent',
  system: 'mobile.chat.toolSystem'
};

export function getToolCategory(toolName: string): { icon: string; cat: ToolCat } {
  const name = toolName.toLowerCase();
  if (name.includes('shell') || name.includes('bash') || name.includes('terminal') || name.includes('exec')) {
    return { icon: '⚡', cat: 'shell' };
  }
  if (name.includes('edit') || name.includes('write') || name.includes('delete') || name.includes('patch')) {
    return { icon: '📝', cat: 'file' };
  }
  if (name.includes('read') || name.includes('grep') || name.includes('glob') || name.includes('find') || name.includes('search')) {
    return { icon: '🔍', cat: 'search' };
  }
  if (name.includes('git')) {
    return { icon: '🌿', cat: 'git' };
  }
  if (name.includes('agent') || name.includes('skill') || name.includes('goal')) {
    return { icon: '🤖', cat: 'agent' };
  }
  return { icon: '⚙️', cat: 'system' };
}

export function diffTextOf(tool: ToolLike): string | undefined {
  const candidate = tool.args?.diff ?? tool.args?.patch ?? tool.args?.contents;
  if (candidate && (candidate.includes('@@ -') || candidate.includes('+++') || candidate.includes('---'))) {
    return candidate;
  }
  if (tool.output && /^(diff --git |\+\+\+ |@@ -)/m.test(tool.output)) return tool.output;
  return undefined;
}

export function DiffLineRow({ line }: { line: DiffLine }) {
  const style =
    line.type === 'add' ? 'bg-success/15' : line.type === 'del' ? 'bg-danger/15' : line.type === 'hunk' ? 'bg-surface-tertiary' : '';
  const color = line.type === 'add' ? 'text-success' : line.type === 'del' ? 'text-danger' : 'text-foreground';
  return (
    <Text className={`px-2 py-0.5 font-mono text-[11px] leading-4 ${style} ${color}`} selectable>
      {line.type === 'add' ? `+ ${line.content}` : line.type === 'del' ? `- ${line.content}` : line.content}
    </Text>
  );
}

export function FullSheet({
  visible,
  title,
  subtitle,
  onClose,
  children
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <FastThemeScope>
        <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
          <GlassHeader className="flex-row items-center justify-between px-4 pb-3 pt-2">
            <View className="flex-1 pr-2">
              <Text numberOfLines={1} className="text-[17px] font-semibold text-foreground">
                {title}
              </Text>
              {subtitle ? (
                <Text numberOfLines={1} className="font-mono text-[13px] text-muted">
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={onClose} className="min-h-11 justify-center px-2 active:opacity-60">
              <Text className="text-[15px] font-semibold text-link">{t('mobile.chat.done')}</Text>
            </Pressable>
          </GlassHeader>
          <View style={{ height: StyleSheet.hairlineWidth }} className="bg-separator" />
          <ScrollView horizontal className="flex-1">
            <ScrollView className="min-w-full p-4">{children}</ScrollView>
          </ScrollView>
        </View>
      </FastThemeScope>
    </Modal>
  );
}

export function toolHint(tool: ToolLike): string {
  const args = tool.args ?? {};
  return tool.statusNote || args.path || args.command || args.query || args.pattern || args.file || args.name || '';
}

export function ToolDetailSheet({ tool, onClose }: { tool: ToolLike | null; onClose: () => void }) {
  const { t } = useTranslation();
  const diffText = tool ? diffTextOf(tool) : undefined;
  const lines = useMemo(() => (diffText ? parseDiffWithLineNumbers(diffText) : []), [diffText]);
  const stats = countDiffStats(diffText);
  if (!tool) return null;
  const { icon, cat } = getToolCategory(tool.tool);
  const label = t(TOOL_COPY[cat]);
  return (
    <FullSheet visible title={`${icon} ${tool.tool}`} subtitle={toolHint(tool) || label} onClose={onClose}>
      {diffText ? (
        <View className="overflow-hidden rounded-2xl border border-black/[0.04] bg-surface-secondary dark:border-white/10 dark:border-t-white/15">
          <View className="flex-row items-center justify-between px-3 py-2">
            <Text className="text-[13px] font-semibold text-muted">{t('mobile.chat.diffTitle')}</Text>
            <View className="flex-row gap-2">
              <Text className="font-mono text-[13px] font-bold text-success">+{stats.add}</Text>
              <Text className="font-mono text-[13px] font-bold text-danger">−{stats.del}</Text>
            </View>
          </View>
          <View className="pb-2">
            {lines.map((line: DiffLine, i: number) => (
              <DiffLineRow key={i} line={line} />
            ))}
          </View>
        </View>
      ) : (
        <View className="rounded-2xl border border-black/[0.04] bg-surface-secondary p-3.5 dark:border-white/10">
          <Text className="font-mono text-[13px] leading-5 text-foreground" selectable>
            {tool.output || toolHint(tool) || t('mobile.chat.stepEmpty')}
          </Text>
        </View>
      )}
    </FullSheet>
  );
}

function RunningPulse() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.7);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.8, { duration: 950, easing: Easing.out(Easing.ease) }),
      -1,
      false
    );
    opacity.value = withRepeat(
      withTiming(0, { duration: 950, easing: Easing.out(Easing.ease) }),
      -1,
      false
    );
    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
    };
  }, [scale, opacity]);

  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value
  }));

  return (
    <View className="h-3.5 w-3.5 items-center justify-center">
      <Animated.View style={haloStyle} className="absolute h-2.5 w-2.5 rounded-full bg-focus" />
      <View className="h-2 w-2 rounded-full bg-focus" />
    </View>
  );
}

function StepMark({ status }: { status: string }) {
  const vars = useThemeVars();
  if (status === 'running') return <RunningPulse />;
  if (status === 'error' || status === 'cancelled') return <Glyph name="cross" size={13} color={vars['--danger']} />;
  return <Glyph name="check" size={13} color={vars['--muted']} />;
}

export function ToolPipelineSheet({
  visible,
  onClose,
  tools,
  onSelectTool
}: {
  visible: boolean;
  onClose: () => void;
  tools: ToolLike[];
  onSelectTool?: (tool: ToolLike) => void;
}) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const anyRunning = tools.some((x) => x.status === 'running');
  const errorCount = tools.filter((x) => x.status === 'error' || x.status === 'cancelled').length;
  const successCount = tools.filter((x) => x.status === 'success').length;

  const title = anyRunning
    ? t('mobile.chat.pipelineRunning', { current: successCount + 1, total: tools.length })
    : t('mobile.chat.pipelineDone', { count: tools.length });

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {errorCount > 0 ? (
        <View className="mb-3 flex-row items-center gap-1.5 rounded-xl border border-danger/20 bg-danger/10 px-3 py-2">
          <Glyph name="alert" size={13} color={vars['--danger']} />
          <Text className="text-[12px] font-medium text-danger">
            {t('mobile.chat.errorCount', { count: errorCount })}
          </Text>
        </View>
      ) : null}

      <View className="gap-2 pb-4">
        {tools.map((tool, idx) => {
          const hint = toolHint(tool);
          const hasDiff = Boolean(diffTextOf(tool));
          const { icon } = getToolCategory(tool.tool);
          return (
            <Pressable
              key={tool.id || idx}
              accessibilityRole="button"
              onPress={() => {
                lightImpact();
                onSelectTool?.(tool);
              }}
              className="flex-row items-center gap-3 rounded-2xl border border-black/[0.04] bg-surface-secondary/70 p-3 dark:border-white/10 active:bg-surface-secondary"
            >
              <View className="w-5 items-center justify-center">
                <StepMark status={tool.status} />
              </View>
              <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-1.5">
                  <Text className="text-[13px]">{icon}</Text>
                  <Text numberOfLines={1} className="font-mono text-[13px] font-semibold text-foreground">
                    {tool.tool}
                  </Text>
                </View>
                {hint ? (
                  <Text numberOfLines={2} className="mt-0.5 font-mono text-[11px] leading-4 text-muted">
                    {hint}
                  </Text>
                ) : null}
              </View>
              {hasDiff ? (
                <View className="rounded-full bg-link/10 px-2 py-0.5">
                  <Text className="font-mono text-[11px] font-semibold text-link">Diff</Text>
                </View>
              ) : (
                <Glyph name="chevron-right" size={13} color={vars['--muted']} />
              )}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

export function AgentToolPipeline({ tools, initiallyOpen = false }: { tools: ToolLike[]; initiallyOpen?: boolean }) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const [sheetOpen, setSheetOpen] = useState(initiallyOpen);
  const [detail, setDetail] = useState<ToolLike | null>(null);

  if (tools.length === 0) return null;

  const anyRunning = tools.some((x) => x.status === 'running');
  const runningTool = [...tools].reverse().find((x) => x.status === 'running');
  const latestTool = runningTool || tools[tools.length - 1];
  const errorCount = tools.filter((x) => x.status === 'error' || x.status === 'cancelled').length;
  const successCount = tools.filter((x) => x.status === 'success').length;

  const title = anyRunning
    ? t('mobile.chat.pipelineRunning', { current: successCount + 1, total: tools.length })
    : t('mobile.chat.pipelineDone', { count: tools.length });

  const activeHint = latestTool ? toolHint(latestTool) : '';

  return (
    <View className="mt-2">
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          lightImpact();
          setSheetOpen(true);
        }}
        className="min-h-11 flex-row items-center justify-between rounded-2xl border border-black/[0.04] bg-surface-secondary px-3.5 py-2.5 active:opacity-70 dark:border-white/10 dark:border-t-white/15"
      >
        <View className="flex-1 flex-row items-center gap-2.5 pr-2">
          <StepMark status={anyRunning ? 'running' : errorCount > 0 ? 'error' : 'success'} />
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="text-[13px] font-semibold text-surface-secondary-foreground">
              {title}
            </Text>
            {anyRunning && latestTool ? (
              <Text numberOfLines={1} className="mt-0.5 font-mono text-[11px] text-muted">
                {latestTool.tool}
                {activeHint ? ` · ${activeHint}` : ''}
              </Text>
            ) : null}
          </View>
        </View>

        <View className="flex-row items-center gap-1.5">
          {errorCount > 0 ? (
            <Text className="text-[11px] font-semibold text-danger">
              {t('mobile.chat.errorCount', { count: errorCount })}
            </Text>
          ) : null}
          <Glyph name="chevron-right" size={14} color={vars['--muted']} />
        </View>
      </Pressable>

      <ToolPipelineSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        tools={tools}
        onSelectTool={(tool) => setDetail(tool)}
      />

      <ToolDetailSheet tool={detail} onClose={() => setDetail(null)} />
    </View>
  );
}
